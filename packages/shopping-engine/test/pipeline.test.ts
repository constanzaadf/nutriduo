/**
 * Prueba de punta a punta de los motores, tal como los encadena la app:
 * perfil → metas → presupuesto del tiempo de comida → porciones → compras.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGoals, slotBudget, DEFAULT_SLOT_SHARES, type ComputeGoalsResult, type ProfileInput } from "@nutriduo/nutrition-engine";
import { planSharedMeal } from "@nutriduo/portion-engine";
import { buildShoppingList, demandsFromMealPlan, diffLists, applyDiff, meaningfulChanges } from "@nutriduo/shopping-engine";
import { bolognese, chickenRice, ingredients } from "../../portion-engine/test/fixtures";

const A: ProfileInput = { birthDate: "1992-03-15", equationConstant: "female", heightCm: 165, weightKg: 62, dailyActivity: "office_walking", training: [{ label: "Trote", met: 8.3, minutes: 45, daysOfWeek: [1, 3, 5] }], goal: "fat_loss" };
const B: ProfileInput = { birthDate: "1990-01-10", equationConstant: "male", heightCm: 180, weightKg: 85, dailyActivity: "standing", training: [{ label: "Pesas", met: 5, minutes: 60, daysOfWeek: [1, 2, 4, 5], resistance: true }], goal: "muscle_gain" };

const goals = (p: ProfileInput) => computeGoals({ profile: p, asOf: "2026-10-22" }) as ComputeGoalsResult;
const budget = (g: ComputeGoalsResult, slot: "lunch" | "dinner") => {
  const b = slotBudget(g.target, DEFAULT_SLOT_SHARES, slot, []).budget;
  return { kcal: b.kcal, protein_g: b.protein_g, carbs_g: b.carbs_g, fat_g: b.fat_g };
};

describe("semana mínima de un hogar de dos", () => {
  const gA = goals(A);
  const gB = goals(B);
  const monday = planSharedMeal({
    recipe: bolognese,
    ingredients,
    participants: [
      { participantId: "A", target: { mode: "macros", budget: budget(gA, "lunch") }, goal: "fat_loss" },
      { participantId: "B", target: { mode: "macros", budget: budget(gB, "lunch") }, goal: "muscle_gain" },
    ],
  });
  const tuesdayB = planSharedMeal({ recipe: chickenRice, ingredients, participants: [{ participantId: "B", target: { mode: "macros", budget: budget(gB, "dinner") }, goal: "muscle_gain" }] });

  it("las metas son distintas y la de B es mayor", () => {
    assert.ok(gB.target.kcal > gA.target.kcal + 500);
  });

  it("cada porción usa el presupuesto de su dueño", () => {
    const [a, b] = monday.portions;
    assert.ok(b!.nutrients.kcal > a!.nutrients.kcal);
    for (const r of monday.portions) assert.ok(["within_tolerance", "with_deviation"].includes(r.status));
  });

  it("la lista suma la boloñesa compartida y la cena individual sin duplicar", () => {
    const demands = [...demandsFromMealPlan("lun", "2026-10-26", monday), ...demandsFromMealPlan("mar", "2026-10-27", tuesdayB)];
    const list = buildShoppingList({ demands, ingredients });
    const aceite = list.find((l) => l.ingredientId === "aceite")!;
    assert.equal(aceite.sources.length, 2, "aceite de la olla + aceite del pollo");
    assert.equal(new Set(list.map((l) => l.key)).size, list.length);
  });

  it("si B cancela su cena, el diff solo quita lo de esa cena", () => {
    const full = buildShoppingList({ demands: [...demandsFromMealPlan("lun", "2026-10-26", monday), ...demandsFromMealPlan("mar", "2026-10-27", tuesdayB)], ingredients });
    const saved = applyDiff(diffLists([], full));
    const reduced = buildShoppingList({ demands: demandsFromMealPlan("lun", "2026-10-26", monday), ingredients });
    const changes = meaningfulChanges(diffLists(saved, reduced));
    const removedKeys = changes.filter((c) => c.kind === "removed").map((c) => c.key.split("|")[0]).sort();
    assert.deepEqual(removedKeys, ["arroz", "comino", "lechuga", "pollo"]);
    assert.ok(changes.some((c) => c.kind === "decreased" && c.key.startsWith("aceite")));
  });
});
