import type { GoalType } from "@nutriduo/nutrition-engine";
import type { PortionWeights, RoundingSteps, Tolerances } from "./types";

/**
 * Pesos por objetivo. En déficit, pasarse de energía pesa más que quedarse
 * corto y quedarse corto de proteína pesa más que pasarse; en superávit, al
 * revés con la energía. Todos son configurables por perfil.
 */
export function defaultWeights(goal: GoalType = "maintenance"): PortionWeights {
  const base: PortionWeights = {
    kcal: [1, 1],
    protein: [0.5, 2],
    carbs: [1, 1],
    fat: [1, 1],
    exchange: [1, 1],
    fidelity: 0.3,
    preference: 0.2,
  };
  switch (goal) {
    case "fat_loss":
      return { ...base, kcal: [3, 1], protein: [0.5, 3], fat: [1.5, 0.5] };
    case "recomposition":
      return { ...base, kcal: [2, 1], protein: [0.5, 3] };
    case "muscle_gain":
      return { ...base, kcal: [1, 3], protein: [0.5, 2], carbs: [0.7, 1.3] };
    default:
      return base;
  }
}

export const DEFAULT_TOLERANCES: Tolerances = { kcal: 0.05, protein: 0.1, carbs: 0.15, fat: 0.15 };

export const DEFAULT_ROUNDING: RoundingSteps = { default: 5, fats: 1, mix: 10, small: 1 };

export const DEFAULT_EXCHANGE_TOLERANCE = 0.25;

export const DEFAULT_MAX_PLATE_G = 750;

/** Límites por defecto, como múltiplos de la cantidad nominal. */
export const DEFAULT_BOUNDS = {
  adjustable: [0.5, 2] as const,
  side: [0.4, 2.5] as const,
  ratio: [0.5, 2] as const,
  mix: [0.5, 2] as const,
  extra: [0.4, 2.5] as const,
};
