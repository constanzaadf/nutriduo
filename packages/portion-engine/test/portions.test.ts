import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sumNutrients } from "@nutriduo/domain";
import {
  evaluateRecipe,
  planSharedMeal,
  solvePortions,
  splitInstructions,
  type PortionRequest,
  type PortionResult,
} from "@nutriduo/portion-engine";
import { bolognese, burger, chickenRice, dressedSalad, ingredients } from "./fixtures";

const grams = (r: PortionResult, ingredientId: string | null, kind?: string) =>
  r.items.find((i) => i.ingredientId === ingredientId && (kind ? i.kind === kind : true))?.grams ?? 0;

const budgetA = { kcal: 550, protein_g: 40, carbs_g: 55, fat_g: 18 }; // déficit
const budgetB = { kcal: 900, protein_g: 55, carbs_g: 110, fat_g: 25 }; // superávit

function assertNutrientsMatchItems(r: PortionResult) {
  const s = sumNutrients(r.items.map((i) => i.nutrients));
  for (const k of ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const) {
    assert.ok(Math.abs(s[k] - r.nutrients[k]) < 1e-9, `${k}: total ≠ suma de ítems`);
  }
}

describe("comida compartida homogénea (tallarines boloñesa)", () => {
  const plan = planSharedMeal({
    recipe: bolognese,
    ingredients,
    participants: [
      { participantId: "A", target: { mode: "macros", budget: budgetA }, goal: "fat_loss" },
      { participantId: "B", target: { mode: "macros", budget: budgetB }, goal: "muscle_gain" },
    ],
  });
  const [a, b] = plan.portions as [PortionResult, PortionResult];

  it("ambos reciben porción sin bloqueos ni datos faltantes", () => {
    assert.ok(["within_tolerance", "with_deviation"].includes(a.status), a.status);
    assert.ok(["within_tolerance", "with_deviation"].includes(b.status), b.status);
    assert.equal(plan.blocked.length, 0);
  });

  it("la salsa se reparte como mezcla terminada y la pasta por separado", () => {
    assert.ok(grams(a, null, "mix") > 0 && grams(b, null, "mix") > 0);
    assert.ok(grams(a, "pasta") > 0 && grams(b, "pasta") > 0);
    assert.equal(a.items.filter((i) => i.kind === "mix").length, 1);
  });

  it("el perfil con más presupuesto recibe más pasta y no menos salsa", () => {
    assert.ok(grams(b, "pasta") > grams(a, "pasta"), `B ${grams(b, "pasta")} vs A ${grams(a, "pasta")}`);
    assert.ok(grams(b, null, "mix") >= grams(a, null, "mix"));
  });

  it("criterio 5: kcal y macros coinciden con los ingredientes asignados", () => {
    assertNutrientsMatchItems(a);
    assertNutrientsMatchItems(b);
  });

  it("redondeo de cocina: mezcla a 10 g, pasta a 5 g", () => {
    assert.equal(grams(a, null, "mix") % 10, 0);
    assert.equal(grams(b, "pasta") % 5, 0);
  });

  it("lo que se cocina es exactamente lo que se reparte (sin peso medido = estimado)", () => {
    assert.ok(plan.mix);
    const m = plan.mix!;
    assert.equal(m.allocatedG, grams(a, null, "mix") + grams(b, null, "mix"));
    assert.ok(Math.abs(m.expectedCookedG - m.allocatedG) < 1e-9);
    assert.equal(m.measured, false);
    assert.equal(a.confidence, "estimated");
    const pastaLine = plan.cookLines.find((l) => l.ingredientId === "pasta");
    assert.equal(pastaLine?.grams, grams(a, "pasta") + grams(b, "pasta"));
    assert.equal(pastaLine?.forParticipant, null);
  });

  it("instrucciones de reparto legibles", () => {
    const txt = splitInstructions(plan, { A: "Coni", B: "Pareja" });
    assert.match(txt[0]!, /^De la preparación: Coni \d+ g · Pareja \d+ g/);
  });

  it("criterio 2 y 1: la porción de B no cambia si cambia el presupuesto de A", () => {
    const plan2 = planSharedMeal({
      recipe: bolognese,
      ingredients,
      participants: [
        { participantId: "A", target: { mode: "macros", budget: { ...budgetA, kcal: 400 } }, goal: "fat_loss" },
        { participantId: "B", target: { mode: "macros", budget: budgetB }, goal: "muscle_gain" },
      ],
    });
    assert.deepEqual(plan2.portions[1]!.items, b.items);
  });

  it("cocinar porciones extra deja sobrante explícito", () => {
    const p = planSharedMeal({
      recipe: bolognese,
      ingredients,
      cook: { kind: "servings", servings: 4 },
      participants: [{ participantId: "A", target: { mode: "macros", budget: budgetA }, goal: "fat_loss" }],
    });
    assert.ok(p.mix!.leftoverG > 0);
    assert.ok(Math.abs(p.mix!.expectedCookedG - (p.mix!.allocatedG + p.mix!.leftoverG)) < 1e-9);
  });

  it("desde un lote pesado: confianza calculada y detección de lote insuficiente", () => {
    const batch = {
      mix: {
        rawLines: [
          { ingredientId: "carne", grams: 500, state: "raw" as const },
          { ingredientId: "tomate", grams: 400, state: "as_sold" as const },
          { ingredientId: "cebolla", grams: 160, state: "raw" as const },
          { ingredientId: "aceite", grams: 20, state: "as_sold" as const },
        ],
        cookedTotalG: 1000,
        measured: true,
      },
      availableG: 300,
    };
    const p = planSharedMeal({
      recipe: bolognese,
      ingredients,
      batch,
      participants: [
        { participantId: "A", target: { mode: "macros", budget: budgetA }, goal: "fat_loss" },
        { participantId: "B", target: { mode: "macros", budget: budgetB }, goal: "muscle_gain" },
      ],
    });
    assert.equal(p.mix!.fromBatch, true);
    assert.equal(p.mix!.cookRawLines.length, 0);
    assert.equal(p.portions[0]!.confidence, "calculated");
    assert.equal(p.mix!.batchInsufficient, p.mix!.allocatedG > 300);
  });
});

describe("restricciones duras", () => {
  it("un alérgeno en un acompañamiento exclusivo bloquea, no se pone en cero", () => {
    const r = solvePortions({
      participantId: "B",
      recipe: burger,
      ingredients,
      target: { mode: "macros", budget: budgetB },
      restrictions: { allergenTags: ["gluten"], excludedIngredientIds: [] },
      extras: [{ ingredientId: "pan", grams: 60, state: "as_sold", role: "side", integerUnitG: 60 }],
    });
    assert.equal(r.status, "blocked_by_restriction");
    assert.equal(r.items.length, 0);
    assert.deepEqual(r.blockedBy?.[0], { ingredientId: "pan", reason: "contiene gluten" });
  });

  it("si el alérgeno está en un acompañamiento de la receta, se puede omitir solo para esa persona", () => {
    const plan = planSharedMeal({
      recipe: bolognese,
      ingredients,
      participants: [
        { participantId: "A", target: { mode: "macros", budget: budgetA }, restrictions: { allergenTags: ["gluten"], excludedIngredientIds: [] }, skipSideIngredientIds: ["pasta"] },
        { participantId: "B", target: { mode: "macros", budget: budgetB } },
      ],
    });
    assert.equal(plan.blocked.length, 0);
    assert.equal(grams(plan.portions[0]!, "pasta"), 0);
    assert.ok(grams(plan.portions[1]!, "pasta") > 0);
  });

  it("si el alérgeno está en la base común, el participante queda bloqueado (requiere variante)", () => {
    const plan = planSharedMeal({
      recipe: bolognese,
      ingredients,
      participants: [
        { participantId: "A", target: { mode: "macros", budget: budgetA }, restrictions: { allergenTags: [], excludedIngredientIds: ["cebolla"] } },
        { participantId: "B", target: { mode: "macros", budget: budgetB } },
      ],
    });
    assert.deepEqual(plan.blocked.map((x) => x.participantId), ["A"]);
    assert.notEqual(plan.portions[1]!.status, "blocked_by_restriction");
  });
});

describe("comportamiento culinario", () => {
  it("modalidad C: unidades enteras de hamburguesa, pan y queso", () => {
    const plan = planSharedMeal({
      recipe: burger,
      ingredients,
      participants: [
        { participantId: "A", target: { mode: "macros", budget: budgetA }, goal: "fat_loss" },
        {
          participantId: "B",
          target: { mode: "macros", budget: budgetB },
          goal: "muscle_gain",
          extras: [
            { ingredientId: "pan", grams: 60, state: "as_sold", role: "side", integerUnitG: 60, minG: 60, maxG: 60 },
            { ingredientId: "queso", grams: 20, state: "as_sold", role: "side", integerUnitG: 20 },
          ],
        },
      ],
    });
    const [a, b] = plan.portions as [PortionResult, PortionResult];
    for (const r of [a, b]) {
      const meat = r.items.find((i) => i.ingredientId === "carne")!;
      assert.ok(Number.isInteger(meat.units), "hamburguesas enteras");
      assert.equal(meat.grams, meat.units! * 85);
    }
    assert.equal(b.items.find((i) => i.ingredientId === "pan")?.units, 1);
    assert.ok(!a.items.some((i) => i.ingredientId === "pan"), "A no recibe el extra de B");
    const exclusive = plan.cookLines.filter((l) => l.forParticipant === "B").map((l) => l.ingredientId).sort();
    assert.deepEqual(exclusive, ["pan", "queso"]);
  });

  it("más proteína no arrastra el aceite proporcionalmente", () => {
    const r = solvePortions({
      participantId: "B",
      recipe: chickenRice,
      ingredients,
      target: { mode: "macros", budget: { kcal: 750, protein_g: 70, carbs_g: 65, fat_g: 16 } },
      goal: "muscle_gain",
    });
    const pollo = grams(r, "pollo");
    const aceite = grams(r, "aceite");
    assert.ok(pollo / 150 > 1.3, `pollo debería subir: ${pollo}`);
    assert.ok(aceite / 8 < pollo / 150, `aceite ${aceite} no debe escalar como el pollo ${pollo}`);
  });

  it("los ingredientes fijos no se mueven", () => {
    const r = solvePortions({ participantId: "A", recipe: chickenRice, ingredients, target: { mode: "macros", budget: budgetA } });
    assert.equal(grams(r, "comino"), 1);
  });

  it("un grupo de proporción mantiene la relación del aliño", () => {
    const r = solvePortions({
      participantId: "A",
      recipe: dressedSalad,
      ingredients,
      target: { mode: "macros", budget: { kcal: 380, protein_g: 40, carbs_g: 10, fat_g: 18 } },
    });
    const ratio = grams(r, "aceite") / grams(r, "tomate");
    assert.ok(Math.abs(ratio - 10 / 30) < 0.12, `proporción aceite/tomate ${ratio}`);
  });

  it("el aceite se redondea a 1 g y el resto a 5 g", () => {
    const r = solvePortions({ participantId: "A", recipe: chickenRice, ingredients, target: { mode: "macros", budget: budgetA } });
    assert.ok(Number.isInteger(grams(r, "aceite")));
    assert.equal(grams(r, "pollo") % 5, 0);
    assert.equal(grams(r, "arroz") % 5, 0);
  });
});

describe("cuando no hay solución razonable", () => {
  it("no fuerza: informa el desvío y la restricción que lo impide", () => {
    const r = solvePortions({
      participantId: "B",
      recipe: dressedSalad,
      ingredients,
      target: { mode: "macros", budget: { kcal: 1400, protein_g: 60, carbs_g: 180, fat_g: 40 } },
    });
    assert.equal(r.status, "with_deviation");
    assert.ok(r.deviations["kcal"]!.abs < 0);
    assert.ok(r.binding.some((b) => b.kind === "item_max" || b.kind === "ratio_max"));
    for (const it of r.items) assert.ok(it.grams >= 0);
  });

  it("un desvío sin límites activos se explica como límite de la composición", () => {
    const r = solvePortions({
      participantId: "A",
      recipe: burger,
      ingredients,
      target: { mode: "macros", budget: budgetA },
      goal: "fat_loss",
    });
    assert.equal(r.status, "with_deviation");
    assert.ok(r.binding.length > 0, "nunca un desvío sin explicación");
    assert.ok(r.binding.some((b) => b.kind === "composition_tradeoff" || b.kind.startsWith("item_")));
  });

  it("si los mínimos ya superan el plato máximo, es infactible con explicación", () => {
    const r = solvePortions({
      participantId: "A",
      recipe: chickenRice,
      ingredients,
      maxPlateG: 100,
      target: { mode: "macros", budget: budgetA },
    });
    assert.equal(r.status, "infeasible");
    assert.equal(r.binding[0]?.kind, "plate_max");
  });
});

describe("modo pauta por intercambios", () => {
  const base: Omit<PortionRequest, "target"> = { participantId: "A", recipe: chickenRice, ingredients };

  it("calza una pauta alcanzable dentro de ±0,25 porciones", () => {
    const r = solvePortions({
      ...base,
      target: { mode: "exchanges", portions: { cereales: 2, carnes_bajas_grasa: 3, verduras_libre: 1, aceites_grasas: 0.25 } },
    });
    assert.equal(r.status, "within_tolerance", JSON.stringify(r.deviations));
    assert.ok(Math.abs((r.exchanges.carnes_bajas_grasa ?? 0) - 3) <= 0.25);
    assert.ok(Math.abs((r.exchanges.cereales ?? 0) - 2) <= 0.25);
  });

  it("si la receta no permite cumplir la pauta, lo dice y muestra lo más cercano", () => {
    const r = solvePortions({ ...base, target: { mode: "exchanges", portions: { carnes_bajas_grasa: 10, cereales: 2 } } });
    assert.equal(r.status, "outside_prescribed_tolerance");
    assert.ok(r.binding.some((b) => b.kind === "prescribed_tolerance"));
    assert.ok(r.items.length > 0);
  });
});

describe("determinismo y trazabilidad", () => {
  it("misma solicitud → mismo resultado y mismo hash", () => {
    const req: PortionRequest = { participantId: "A", recipe: bolognese, ingredients, target: { mode: "macros", budget: budgetA }, goal: "fat_loss" };
    const r1 = solvePortions(req);
    const r2 = solvePortions(req);
    assert.deepEqual(r1, r2);
    assert.match(r1.trace.inputHash, /^[0-9a-f]{8}$/);
  });

  it("una solicitud distinta cambia el hash", () => {
    const a = solvePortions({ participantId: "A", recipe: chickenRice, ingredients, target: { mode: "macros", budget: budgetA } });
    const b = solvePortions({ participantId: "A", recipe: chickenRice, ingredients, target: { mode: "macros", budget: budgetB } });
    assert.notEqual(a.trace.inputHash, b.trace.inputHash);
  });
});

describe("evaluación de recetas por perfil", () => {
  it("adecuada cuando la porción nominal ya calza", () => {
    const ev0 = evaluateRecipe({ recipe: chickenRice, ingredients, target: { mode: "macros", budget: budgetA } });
    const n = ev0.serving.nutrients;
    const ev = evaluateRecipe({
      recipe: chickenRice,
      ingredients,
      target: { mode: "macros", budget: { kcal: n.kcal, protein_g: n.protein_g, carbs_g: n.carbs_g, fat_g: n.fat_g } },
    });
    assert.equal(ev.fit, "suitable");
    assert.equal(ev.adjusted, null);
  });

  it("adecuada con ajustes cuando basta cambiar gramajes", () => {
    const ev = evaluateRecipe({ recipe: chickenRice, ingredients, target: { mode: "macros", budget: { kcal: 700, protein_g: 55, carbs_g: 70, fat_g: 18 } } });
    assert.equal(ev.fit, "suitable_with_adjustments", JSON.stringify(ev.adjusted?.deviations));
  });

  it("requiere modificaciones cuando ni ajustando calza", () => {
    const ev = evaluateRecipe({ recipe: dressedSalad, ingredients, target: { mode: "macros", budget: { kcal: 1400, protein_g: 60, carbs_g: 180, fat_g: 40 } } });
    assert.equal(ev.fit, "needs_modifications");
    assert.ok(ev.reasons.length > 0);
  });

  it("calcula métricas de densidad y proteína", () => {
    const ev = evaluateRecipe({ recipe: chickenRice, ingredients, target: { mode: "macros", budget: budgetA } });
    assert.ok(ev.metrics.kcalPer100g > 0);
    assert.ok(ev.metrics.proteinGPer100Kcal > 5);
  });
});
