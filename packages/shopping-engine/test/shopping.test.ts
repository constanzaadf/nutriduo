import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planSharedMeal } from "@nutriduo/portion-engine";
import {
  applyDiff,
  buildShoppingList,
  demandsFromBatch,
  demandsFromMealPlan,
  diffLists,
  meaningfulChanges,
  suggestPacks,
  type Demand,
  type ExistingItem,
} from "@nutriduo/shopping-engine";
import { bolognese, chickenRice, ingredients } from "../../portion-engine/test/fixtures";

const budgetA = { kcal: 550, protein_g: 40, carbs_g: 55, fat_g: 18 };
const budgetB = { kcal: 900, protein_g: 55, carbs_g: 110, fat_g: 25 };

const sharedBolognese = planSharedMeal({
  recipe: bolognese,
  ingredients,
  participants: [
    { participantId: "A", target: { mode: "macros", budget: budgetA }, goal: "fat_loss" },
    { participantId: "B", target: { mode: "macros", budget: budgetB }, goal: "muscle_gain" },
  ],
});
const individualChickenB = planSharedMeal({
  recipe: chickenRice,
  ingredients,
  participants: [{ participantId: "B", target: { mode: "macros", budget: budgetB }, goal: "muscle_gain" }],
});
const individualChickenA = planSharedMeal({
  recipe: chickenRice,
  ingredients,
  participants: [{ participantId: "A", target: { mode: "macros", budget: budgetA }, goal: "fat_loss" }],
});

const line = (list: ReturnType<typeof buildShoppingList>, id: string) => list.find((l) => l.ingredientId === id);

describe("consolidación (criterio 4)", () => {
  const demands = [
    ...demandsFromMealPlan("ev-lun-alm", "2026-10-26", sharedBolognese),
    ...demandsFromMealPlan("ev-lun-cena-B", "2026-10-26", individualChickenB),
    ...demandsFromMealPlan("ev-mar-cena-A", "2026-10-27", individualChickenA),
  ];
  const list = buildShoppingList({ demands, ingredients });

  it("cada ingrediente aparece una sola vez", () => {
    const keys = list.map((l) => l.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("el aceite de la boloñesa y de ambos pollos se suma en una línea", () => {
    const aceite = line(list, "aceite")!;
    const expected = demands.filter((d) => d.ingredientId === "aceite").reduce((a, d) => a + d.grams, 0);
    assert.equal(aceite.needG, expected);
    assert.equal(aceite.sources.length, demands.filter((d) => d.ingredientId === "aceite").length);
  });

  it("las comidas individuales suman cantidades específicas por persona", () => {
    const pollo = line(list, "pollo")!;
    const a = individualChickenA.cookLines.find((l) => l.ingredientId === "pollo")!.grams;
    const b = individualChickenB.cookLines.find((l) => l.ingredientId === "pollo")!.grams;
    assert.equal(pollo.needG, a + b);
  });

  it("agrupa por categoría para recorrer el supermercado", () => {
    const cats = list.map((l) => l.category);
    const firstCarnes = cats.indexOf("carnes");
    const lastVerduras = cats.lastIndexOf("verduras");
    assert.ok(lastVerduras < firstCarnes, "verduras antes que carnes");
  });
});

describe("lotes y sobrantes (criterio 9)", () => {
  it("lo servido desde un lote existente no vuelve a comprarse", () => {
    const fromBatch = planSharedMeal({
      recipe: bolognese,
      ingredients,
      batch: {
        mix: { rawLines: [{ ingredientId: "carne", grams: 500, state: "raw" }, { ingredientId: "tomate", grams: 400, state: "as_sold" }, { ingredientId: "cebolla", grams: 160, state: "raw" }, { ingredientId: "aceite", grams: 20, state: "as_sold" }], cookedTotalG: 1000, measured: true },
        availableG: 1000,
      },
      participants: [{ participantId: "A", target: { mode: "macros", budget: budgetA } }],
    });
    const d = demandsFromMealPlan("ev", "2026-10-27", fromBatch);
    assert.deepEqual(d.map((x) => x.ingredientId), ["pasta"], "solo el acompañamiento cocinado ese día");
  });

  it("el lote planificado sí genera demanda una vez, con sus crudos", () => {
    const d = demandsFromBatch("lote-dom", "2026-10-25", [{ ingredientId: "carne", grams: 800, state: "raw" }]);
    const list = buildShoppingList({ demands: d, ingredients });
    assert.equal(line(list, "carne")!.needG, 800);
    assert.equal(line(list, "carne")!.sources[0]!.kind, "batch");
  });
});

describe("inventario", () => {
  const demands: Demand[] = [
    { ingredientId: "pasta", grams: 500, state: "raw", source: { kind: "event", refId: "e1", participantId: null, date: "2026-10-27" } },
    { ingredientId: "arroz", grams: 200, state: "raw", source: { kind: "event", refId: "e2", participantId: "A", date: "2026-10-28" } },
    { ingredientId: "pollo", grams: 300, state: "raw", source: { kind: "event", refId: "e3", participantId: "B", date: "2026-10-29" } },
  ];

  it("compra = máx(0, necesidad − disponible); nunca negativo", () => {
    const list = buildShoppingList({
      demands,
      ingredients,
      inventory: [{ id: "i1", ingredientId: "pasta", grams: 370, state: "raw" }, { id: "i2", ingredientId: "arroz", grams: 1000, state: "raw" }],
    });
    assert.equal(line(list, "pasta")!.buyG, 130);
    assert.equal(line(list, "pasta")!.availableG, 370);
    assert.equal(line(list, "arroz")!.buyG, 0);
    assert.equal(line(list, "arroz")!.availableG, 200);
    for (const l of list) assert.ok(l.buyG >= 0);
  });

  it("ignora lotes vencidos antes del primer uso y lo reservado para otros", () => {
    const list = buildShoppingList({
      demands,
      ingredients,
      inventory: [
        { id: "i3", ingredientId: "pollo", grams: 300, state: "raw", expiresOn: "2026-10-28" },
        { id: "i4", ingredientId: "pasta", grams: 500, state: "raw", reservedForOthersG: 400 },
      ],
    });
    assert.equal(line(list, "pollo")!.buyG, 300);
    assert.equal(line(list, "pasta")!.buyG, 400);
  });

  it("no descuenta inventario cocido contra una compra cruda", () => {
    const list = buildShoppingList({ demands, ingredients, inventory: [{ id: "i5", ingredientId: "arroz", grams: 500, state: "cooked" }] });
    assert.equal(line(list, "arroz")!.buyG, 200);
  });
});

describe("crudo y cocido nunca se mezclan", () => {
  it("una demanda cocida se convierte a cruda con el rendimiento", () => {
    const list = buildShoppingList({
      demands: [
        { ingredientId: "arroz", grams: 280, state: "cooked", source: { kind: "event", refId: "e", participantId: null, date: "2026-10-27" } },
        { ingredientId: "arroz", grams: 50, state: "raw", source: { kind: "event", refId: "f", participantId: null, date: "2026-10-27" } },
      ],
      ingredients,
    });
    assert.equal(list.length, 1);
    assert.ok(Math.abs(line(list, "arroz")!.needG - 150) < 1e-9, "280/2,8 + 50");
  });

  it("sin rendimiento queda como línea separada y marcada", () => {
    const list = buildShoppingList({
      demands: [
        { ingredientId: "lechuga", grams: 100, state: "cooked", source: { kind: "event", refId: "e", participantId: null, date: "2026-10-27" } },
        { ingredientId: "lechuga", grams: 100, state: "raw", source: { kind: "event", refId: "f", participantId: null, date: "2026-10-27" } },
      ],
      ingredients,
    });
    assert.equal(list.length, 2);
    assert.ok(list.find((l) => l.state === "cooked")!.needsConversion);
  });
});

describe("formatos comerciales", () => {
  it("ejemplo del prompt: 650 g con bandeja de 800 g → 1 bandeja, sobran 150 g", () => {
    const s = suggestPacks(650, [{ ingredientId: "pollo", grams: 800, label: "Bandeja 800 g", price: 5990 }])!;
    assert.deepEqual(s.packs, [{ label: "Bandeja 800 g", grams: 800, count: 1 }]);
    assert.equal(s.surplusG, 150);
    assert.equal(s.estimatedPrice, 5990);
  });

  it("elige el menor exceso y, a igual exceso, menos envases", () => {
    const sizes = [
      { ingredientId: "x", grams: 500, label: "500 g" },
      { ingredientId: "x", grams: 800, label: "800 g" },
    ];
    assert.equal(suggestPacks(1100, sizes)!.totalG, 1300);
    assert.equal(suggestPacks(1000, sizes)!.totalG, 1000);
    assert.equal(suggestPacks(1000, sizes)!.packCount, 2);
    assert.equal(suggestPacks(1600, sizes)!.packCount, 2, "2×800 antes que 500+500+…");
  });

  it("sin formato cargado no inventa uno", () => {
    const list = buildShoppingList({
      demands: [{ ingredientId: "pollo", grams: 650, state: "raw", source: { kind: "event", refId: "e", participantId: null, date: "2026-10-27" } }],
      ingredients,
    });
    assert.equal(line(list, "pollo")!.pack, null);
    assert.equal(line(list, "pollo")!.buyG, 650);
  });
});

describe("diferencias al recalcular (criterio 6)", () => {
  const base = buildShoppingList({ demands: demandsFromMealPlan("ev1", "2026-10-26", sharedBolognese), ingredients });
  const existing: ExistingItem[] = [
    ...base.map((l) => ({ key: l.key, ingredientId: l.ingredientId, label: l.label, buyG: l.buyG, checked: l.ingredientId === "carne", checkedG: l.ingredientId === "carne" ? l.buyG : 0, manual: false, sourceHash: l.sourceHash })),
    { key: "manual:papel", ingredientId: null, label: "Papel de cocina", buyG: 0, checked: false, checkedG: 0, manual: true, sourceHash: null },
  ];

  it("sin cambios en el calendario no hay cambios que revisar", () => {
    assert.deepEqual(meaningfulChanges(diffLists(existing, base)), []);
  });

  it("agregar una comida aparece como agregados y aumentos", () => {
    const next = buildShoppingList({
      demands: [...demandsFromMealPlan("ev1", "2026-10-26", sharedBolognese), ...demandsFromMealPlan("ev2", "2026-10-27", individualChickenB)],
      ingredients,
    });
    const d = meaningfulChanges(diffLists(existing, next));
    assert.ok(d.some((x) => x.kind === "added" && x.key.startsWith("pollo")));
    assert.ok(d.some((x) => x.kind === "increased" && x.key.startsWith("aceite")));
  });

  it("lo manual y lo ya comprado sobreviven aunque la comida se elimine", () => {
    const d = diffLists(existing, []);
    const result = applyDiff(d);
    assert.ok(result.some((r) => r.key === "manual:papel"));
    const carne = d.find((x) => x.key.startsWith("carne"))!;
    assert.equal(carne.kind, "orphan_checked");
    assert.ok(result.some((r) => r.key === carne.key && r.checked));
    assert.ok(!result.some((r) => r.key.startsWith("cebolla")), "lo no comprado y no manual se elimina");
  });

  it("si sube algo ya comprado, lo comprado se conserva y queda el faltante", () => {
    const carneKey = base.find((l) => l.ingredientId === "carne")!.key;
    const bigger = base.map((l) => (l.key === carneKey ? { ...l, buyG: l.buyG + 200 } : l));
    const entry = diffLists(existing, bigger).find((x) => x.key === carneKey)!;
    assert.equal(entry.kind, "increased");
    assert.equal(entry.proposed!.checked, false);
    assert.equal(entry.proposed!.checkedG, entry.fromG);
    assert.equal(entry.proposed!.buyG - entry.proposed!.checkedG, 200);
  });

  it("el hash de origen es estable para la misma entrada", () => {
    const again = buildShoppingList({ demands: demandsFromMealPlan("ev1", "2026-10-26", sharedBolognese), ingredients });
    assert.deepEqual(again.map((l) => l.sourceHash), base.map((l) => l.sourceHash));
  });
});
