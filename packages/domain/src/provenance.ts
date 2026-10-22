/**
 * Procedencia y confianza de una cifra. La regla es simple: una cifra
 * derivada nunca es más confiable que su insumo menos confiable.
 */

export type Confidence = "prescribed" | "calculated" | "estimated";

const RANK: Record<Confidence, number> = { prescribed: 3, calculated: 2, estimated: 1 };

/** Confianza combinada = la del insumo más débil. */
export function weakest(...levels: Confidence[]): Confidence {
  if (levels.length === 0) return "calculated";
  return levels.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
}

export type NutritionSource = "fdc" | "label" | "manual" | "exchange_table";

export const CONFIDENCE_LABEL_ES: Record<Confidence, string> = {
  prescribed: "Prescrito",
  calculated: "Calculado",
  estimated: "Estimado",
};
