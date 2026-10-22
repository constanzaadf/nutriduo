import { nutrientsForGrams, sumNutrients, weakest, type Confidence, type Ingredient, type Nutrients, type RecipeVersion } from "@nutriduo/domain";
import { DEFAULT_TOLERANCES } from "./defaults";
import { nominalMix } from "./items";
import { solvePortions } from "./solve";
import type { PortionRequest, PortionResult, Tolerances } from "./types";

/**
 * Evaluación de una receta PARA un perfil y un tiempo de comida. No hay
 * "comida mala": una receta es adecuada, adecuada con ajustes de porción, o
 * requiere modificaciones para ese objetivo.
 */

export type RecipeFit = "suitable" | "suitable_with_adjustments" | "needs_modifications" | "blocked" | "missing_data";

export const FIT_LABEL_ES: Record<RecipeFit, string> = {
  suitable: "Adecuada para el objetivo",
  suitable_with_adjustments: "Adecuada con ajustes",
  needs_modifications: "Requiere modificaciones importantes",
  blocked: "No compatible con las restricciones",
  missing_data: "Faltan datos para evaluar",
};

export interface ServingNutrition {
  nutrients: Nutrients;
  /** Peso estimado de la porción en el plato (cocido). */
  plateG: number;
  confidence: Confidence;
  missing: string[];
}

/** Nutrientes de una porción nominal de la receta (todas las líneas, incluidos acompañamientos). */
export function nominalServing(recipe: RecipeVersion, ingredients: ReadonlyMap<string, Ingredient>): ServingNutrition {
  const parts: Nutrients[] = [];
  const missing: string[] = [];
  let confidence: Confidence = "calculated";
  let plateG = 0;
  for (const l of recipe.lines) {
    const ing = ingredients.get(l.ingredientId);
    const row = ing?.nutrition[l.state];
    if (!ing || !row) {
      missing.push(l.ingredientId);
      continue;
    }
    parts.push(nutrientsForGrams(row.per100g, l.grams));
    confidence = weakest(confidence, row.confidence);
    const y = l.state === "cooked" ? 1 : ing.yieldFactors?.["default"] ?? 1;
    if (!recipe.isHomogeneous || l.role === "side") plateG += l.grams * y;
  }
  if (recipe.isHomogeneous) {
    const mix = nominalMix(recipe, ingredients);
    plateG += mix.cookedTotalG / recipe.servingsNominal;
    confidence = weakest(confidence, "estimated");
  }
  return { nutrients: sumNutrients(parts), plateG, confidence, missing };
}

export interface RecipeEvaluation {
  fit: RecipeFit;
  serving: ServingNutrition;
  metrics: {
    kcalPer100g: number;
    proteinGPer100Kcal: number;
    fiberGPer1000Kcal: number;
    sodiumMgPerServing: number | null;
  };
  /** Solo si hizo falta ajustar porciones. */
  adjusted: PortionResult | null;
  reasons: string[];
}

export function evaluateRecipe(
  req: Omit<PortionRequest, "participantId"> & { participantId?: string },
  tolerances: Partial<Tolerances> = {},
): RecipeEvaluation {
  const serving = nominalServing(req.recipe, req.ingredients);
  const n = serving.nutrients;
  const metrics = {
    kcalPer100g: serving.plateG > 0 ? (n.kcal / serving.plateG) * 100 : 0,
    proteinGPer100Kcal: n.kcal > 0 ? (n.protein_g / n.kcal) * 100 : 0,
    fiberGPer1000Kcal: n.kcal > 0 ? (n.fiber_g / n.kcal) * 1000 : 0,
    sodiumMgPerServing: n.sodium_mg,
  };
  if (serving.missing.length > 0) {
    return { fit: "missing_data", serving, metrics, adjusted: null, reasons: [`Faltan datos de ${serving.missing.length} ingrediente(s).`] };
  }

  const reasons: string[] = [];
  const tol = { ...DEFAULT_TOLERANCES, ...tolerances };
  if (req.target.mode === "macros") {
    const b = req.target.budget;
    const checks: [string, number, number, number][] = [
      ["Energía", n.kcal, b.kcal, tol.kcal],
      ["Proteína", n.protein_g, b.protein_g, tol.protein],
      ["Carbohidratos", n.carbs_g, b.carbs_g, tol.carbs],
      ["Grasas", n.fat_g, b.fat_g, tol.fat],
    ];
    const nominalOk = checks.every(([, a, t, k]) => t <= 0 || Math.abs(a - t) / t <= k);
    if (nominalOk) {
      return { fit: "suitable", serving, metrics, adjusted: null, reasons: ["La porción nominal ya calza con el presupuesto de esta comida."] };
    }
    for (const [label, a, t, k] of checks) {
      if (t > 0 && Math.abs(a - t) / t > k) {
        reasons.push(`${label}: la porción nominal aporta ${Math.round(a)} frente a ${Math.round(t)} del presupuesto.`);
      }
    }
  }

  const adjusted = solvePortions({ ...req, participantId: req.participantId ?? "eval" });
  if (adjusted.status === "blocked_by_restriction") {
    return { fit: "blocked", serving, metrics, adjusted, reasons: (adjusted.blockedBy ?? []).map((b) => `${b.ingredientId}: ${b.reason}`) };
  }
  if (adjusted.status === "missing_data") {
    return { fit: "missing_data", serving, metrics, adjusted, reasons: (adjusted.missing ?? []).map((m) => `${m.ingredientId}: ${m.reason}`) };
  }
  if (adjusted.status === "within_tolerance") {
    reasons.push("Ajustando gramajes queda dentro de tolerancia, sin cambiar ingredientes.");
    return { fit: "suitable_with_adjustments", serving, metrics, adjusted, reasons };
  }
  reasons.push(...adjusted.binding.map((b) => b.message));
  return { fit: "needs_modifications", serving, metrics, adjusted, reasons };
}
