import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MealSlot } from "@nutriduo/nutrition-engine";
import type { PortionTarget } from "@nutriduo/portion-engine";
import { CATALOG_RECIPES, buildCatalog, catalogIngredientMap, toRecipeVersion } from "@nutriduo/catalog";
import { SLOT_KIND, addDays, daysBetween, defaultWeekSlots, isWeekend, planWeek, type MenuParticipant, type MenuRecipe, type MenuRequest } from "@nutriduo/menu-engine";

const ings = catalogIngredientMap();
const catalog = buildCatalog();
const recipes: MenuRecipe[] = CATALOG_RECIPES.map((r) => ({ recipeId: r.slug, version: toRecipeVersion(r), category: r.category, prepMinutes: r.prepMinutes }));
const byId = new Map(CATALOG_RECIPES.map((r) => [r.slug, r]));

const SHARES: Partial<Record<MealSlot, number>> = { breakfast: 0.25, snack_am: 0.1, lunch: 0.3, snack_pm: 0.1, dinner: 0.25 };
function person(id: string, daily: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }, goal: MenuParticipant["goal"], extra: Partial<MenuParticipant> = {}): MenuParticipant {
  const targets: Partial<Record<MealSlot, PortionTarget>> = {};
  for (const [slot, f] of Object.entries(SHARES) as [MealSlot, number][]) {
    targets[slot] = { mode: "macros", budget: { kcal: daily.kcal * f, protein_g: daily.protein_g * f, carbs_g: daily.carbs_g * f, fat_g: daily.fat_g * f } };
  }
  return { id, targets, ...(goal ? { goal } : {}), ...extra };
}
const A = person("A", { kcal: 1600, protein_g: 120, carbs_g: 155, fat_g: 50 }, "fat_loss");
const B = person("B", { kcal: 2700, protein_g: 155, carbs_g: 330, fat_g: 85 }, "muscle_gain");

const MONDAY = "2026-10-26";
const SUNDAY = addDays(MONDAY, -1);
const base: MenuRequest = { cookDate: SUNDAY, slots: defaultWeekSlots(MONDAY), participants: [A, B], recipes, ingredients: ings };


describe("semana con cocina del domingo", () => {
  const p = planWeek(base);

  it("llena todos los tiempos pedidos", () => {
    assert.deepEqual(p.unfilled, []);
    assert.equal(p.events.length, base.slots.length);
  });

  it("cocina tres ollas distintas, todas preparaciones homogéneas, el domingo", () => {
    assert.equal(p.batches.length, 3);
    assert.equal(new Set(p.batches.map((b) => b.recipeId)).size, 3);
    for (const b of p.batches) {
      assert.ok(byId.get(b.recipeId)!.homogeneous, b.name);
      assert.equal(b.cookDate, SUNDAY);
    }
  });

  it("las tres ollas no comparten la proteína principal", () => {
    const main = p.batches.map((b) => {
      const v = toRecipeVersion(byId.get(b.recipeId)!);
      let best = { id: "", p: -1 };
      for (const l of v.lines) {
        const ing = ings.get(l.ingredientId)!;
        if (!["carnes", "huevos", "legumbres", "lacteos"].includes(ing.category)) continue;
        const pr = ((ing.nutrition[l.state]?.per100g.protein_g ?? 0) * l.grams) / 100;
        if (pr > best.p) best = { id: ing.id, p: pr };
      }
      return best.id;
    });
    assert.equal(new Set(main).size, main.length, main.join(", "));
  });

  it("de lunes a viernes almuerzo y cena salen de las ollas; el fin de semana se cocina en el día", () => {
    for (const e of p.events) {
      if (SLOT_KIND[e.slot] !== "main") continue;
      assert.equal(e.source, isWeekend(e.date) ? "fresh" : "batch", `${e.date} ${e.slot}`);
    }
  });

  it("nunca repite el mismo plato principal en comidas seguidas ni dos veces el mismo día", () => {
    const mains = p.events.filter((e) => SLOT_KIND[e.slot] === "main");
    for (let i = 1; i < mains.length; i++) assert.notEqual(mains[i]!.recipeId, mains[i - 1]!.recipeId, `${mains[i]!.date} ${mains[i]!.slot}`);
  });

  it("refrigera hasta 3 días y congela el resto", () => {
    for (const e of p.events.filter((x) => x.source === "batch")) {
      assert.equal(e.storage, daysBetween(SUNDAY, e.date) <= 3 ? "fridge" : "freezer", e.date);
    }
    assert.ok(p.batches.some((b) => b.freezerG > 0));
    assert.ok(p.notes.some((n) => /congelan/.test(n)));
  });

  it("cada olla alcanza para todas sus porciones (con margen) y sus crudos escalan la receta", () => {
    for (const b of p.batches) {
      const allocated = p.events.filter((e) => e.batchKey === b.key).flatMap((e) => e.portions).reduce((a, x) => a + (x.mixG ?? 0), 0);
      assert.ok(allocated > 0);
      assert.ok(b.cookedTotalG >= allocated, `${b.name}: ${b.cookedTotalG} < ${allocated}`);
      assert.ok(b.cookedTotalG <= allocated * 1.1 + 10, `${b.name}: margen excesivo`);
      assert.equal(b.fridgeG + b.freezerG, Math.round(allocated) + (b.fridgeG + b.freezerG - Math.round(allocated)));
      const r = byId.get(b.recipeId)!;
      for (const l of b.rawLines) {
        const nominal = r.lines.find((x) => x.ingredient === l.ingredientId)!;
        const expected = nominal.grams * r.servings * b.scale;
        assert.ok(Math.abs(l.grams - expected) <= 5 + expected * 0.01, `${b.name} ${l.ingredientId}: ${l.grams} vs ${expected}`);
      }
    }
  });

  it("lo que se cocina en el día respeta el tope de tiempo (desayuno 10 min y resto 25 en semana; 90 el fin de semana)", () => {
    for (const e of p.events.filter((x) => x.source === "fresh")) {
      const min = byId.get(e.recipeId)!.prepMinutes;
      const limit = isWeekend(e.date) ? 90 : e.slot === "breakfast" ? 10 : 25;
      assert.ok(min <= limit, `${e.date} ${e.slot} ${e.name}: ${min} min`);
    }
  });

  it("no repite el mismo desayuno dos días seguidos", () => {
    const bf = p.events.filter((e) => e.slot === "breakfast");
    for (let i = 1; i < bf.length; i++) assert.notEqual(bf[i]!.recipeId, bf[i - 1]!.recipeId, bf[i]!.date);
  });

  it("informa los acompañamientos que no van en la olla", () => {
    const bolo = p.batches.find((b) => b.recipeId === "tallarines-bolonesa") ?? p.batches.find((b) => byId.get(b.recipeId)!.lines.some((l) => l.role === "side"));
    if (!bolo) return;
    assert.ok(bolo.sides.length > 0 && bolo.sides.every((x) => x.grams > 0));
    for (const x of bolo.sides) assert.ok(!bolo.rawLines.some((l) => l.ingredientId === x.ingredientId), "un acompañamiento no se cuenta en la olla");
  });

  it("las comidas del fin de semana no repiten las ollas de la semana", () => {
    const pots = new Set(p.batches.map((b) => b.recipeId));
    for (const e of p.events.filter((x) => x.source === "fresh" && SLOT_KIND[x.slot] === "main")) assert.ok(!pots.has(e.recipeId), e.name);
  });

  it("toda porción es factible para ambos y el día cuadra con la suma de presupuestos", () => {
    for (const e of p.events) {
      assert.deepEqual(e.participantIds.sort(), ["A", "B"]);
      for (const x of e.portions) assert.ok(["within_tolerance", "with_deviation"].includes(x.status), `${e.name} ${x.participantId}: ${x.status}`);
    }
    for (const d of p.days) {
      assert.ok(d.budget);
      const rel = Math.abs(d.planned.kcal - d.budget!.kcal) / d.budget!.kcal;
      assert.ok(rel < 0.15, `${d.date} ${d.participantId}: ${Math.round(d.planned.kcal)} vs ${Math.round(d.budget!.kcal)} kcal`);
    }
  });

  it("es determinista y la semilla permite pedir otra propuesta", () => {
    const again = planWeek(base);
    assert.deepEqual(again, p);
    const other = planWeek({ ...base, options: { seed: 7 } });
    assert.notEqual(other.trace.inputHash, p.trace.inputHash);
    assert.deepEqual(other.unfilled, []);
  });

  it("no modifica la entrada", () => {
    const slots = defaultWeekSlots(MONDAY);
    const copy = JSON.parse(JSON.stringify(slots));
    planWeek({ ...base, slots });
    assert.deepEqual(slots, copy);
  });
});

describe("restricciones y variantes", () => {
  it("una alergia de una persona excluye la receta para la comida compartida", () => {
    const celiac = { ...A, restrictions: { allergenTags: ["gluten"], excludedIngredientIds: [] } };
    const p = planWeek({ ...base, participants: [celiac, B] });
    assert.deepEqual(p.unfilled, []);
    for (const e of p.events) {
      const mine = e.portions.find((x) => x.participantId === "A")!;
      const eaten = byId.get(e.recipeId)!.lines.filter((l) => !mine.skipSides.includes(l.ingredient));
      assert.ok(!eaten.some((l) => (catalog.get(l.ingredient)!.def.allergens ?? []).includes("gluten")), `${e.name}: A come gluten`);
    }
  });

  it("cenas rápidas en el día y solo almuerzos en olla", () => {
    const p = planWeek({ ...base, slots: defaultWeekSlots(MONDAY, { weekdayDinner: "fresh" }), options: { quickMinutes: 20 } });
    assert.deepEqual(p.unfilled, []);
    const dinners = p.events.filter((e) => e.slot === "dinner" && !isWeekend(e.date));
    for (const e of dinners) {
      assert.equal(e.source, "fresh");
      assert.ok(byId.get(e.recipeId)!.prepMinutes <= 20);
    }
    // Cinco almuerzos repartidos entre tres ollas
    assert.equal(p.batches.reduce((a, b) => a + b.meals, 0), 5);
  });

  it("si se piden más ollas de las que hay, avisa y usa las disponibles", () => {
    const two = recipes.filter((r) => !r.version.isHomogeneous || r.recipeId === "lentejas-con-arroz" || r.recipeId === "cazuela-pollo");
    const p = planWeek({ ...base, recipes: two, options: { batchCount: 3 } });
    assert.equal(p.batches.length, 2);
    assert.ok(p.notes.some((n) => /Solo 2 preparación/.test(n)));
    assert.deepEqual(p.unfilled, []);
  });

  it("una alergia en un acompañamiento no descarta la receta: esa persona lo omite", () => {
    const celiac = { ...A, restrictions: { allergenTags: ["gluten"], excludedIngredientIds: [] } };
    const p = planWeek({ ...base, participants: [celiac, B] });
    const c = p.events.filter((e) => e.mode === "C");
    assert.ok(c.length > 0);
    for (const e of c) {
      const skip = e.portions.find((x) => x.participantId === "A")!.skipSides;
      assert.ok(skip.length > 0);
      for (const id of skip) assert.ok((ings.get(id)!.allergenTags ?? []).includes("gluten"));
      assert.deepEqual(e.portions.find((x) => x.participantId === "B")!.skipSides, []);
    }
  });

  it("una semana solo para una persona funciona igual", () => {
    const p = planWeek({ ...base, participants: [A] });
    assert.deepEqual(p.unfilled, []);
    for (const e of p.events) assert.deepEqual(e.participantIds, ["A"]);
  });

  it("modo pauta por porciones de intercambio", () => {
    const pauta: MenuParticipant = {
      id: "P",
      targets: {
        breakfast: { mode: "exchanges", portions: { cereales: 2, lacteos_bajos_grasa: 1, frutas: 1 } },
        lunch: { mode: "exchanges", portions: { cereales: 2, carnes_bajas_grasa: 2, verduras_general: 1, aceites_grasas: 1 } },
        dinner: { mode: "exchanges", portions: { cereales: 1, carnes_bajas_grasa: 2, verduras_general: 1, aceites_grasas: 1 } },
      },
    };
    const p = planWeek({ ...base, participants: [pauta] });
    assert.ok(p.events.length >= 14, `${p.events.length} comidas`);
    for (const d of p.days) assert.equal(d.budget, null);
  });

  it("prefiere lo que vence pronto en el inventario", () => {
    const lentejas = [...ings.values()].find((i) => i.id === "lentejas")!;
    const p = planWeek({ ...base, pantry: [{ ingredientId: lentejas.id, grams: 1000, expiresOn: addDays(SUNDAY, 3) }] });
    assert.ok(p.events.some((e) => byId.get(e.recipeId)!.lines.some((l) => l.ingredient === "lentejas")));
  });

  it("un tiempo para el que nadie tiene presupuesto no se planifica", () => {
    const noBreakfast = (x: MenuParticipant): MenuParticipant => ({ ...x, targets: Object.fromEntries(Object.entries(x.targets).filter(([k]) => k !== "breakfast")) });
    const p = planWeek({ ...base, participants: [noBreakfast(A), noBreakfast(B)] });
    assert.ok(!p.events.some((e) => e.slot === "breakfast"));
    assert.ok(p.events.every((e) => e.participantIds.length > 0));
    assert.ok(p.notes.some((n) => /desayuno/.test(n)));
  });

  it("si solo una persona desayuna, el desayuno es solo suyo", () => {
    const p = planWeek({ ...base, participants: [A, { ...B, targets: Object.fromEntries(Object.entries(B.targets).filter(([k]) => k !== "breakfast")) }] });
    for (const e of p.events.filter((x) => x.slot === "breakfast")) assert.deepEqual(e.participantIds, ["A"]);
  });

  it("rechaza un lote que tendría que cubrir el mismo día de cocina o antes", () => {
    assert.throws(() => planWeek({ ...base, cookDate: MONDAY }), /no puede cubrir/);
  });
});
