import type { FoodState, Ingredient } from "./ingredients";

/**
 * Conversión de cantidades a gramos. Solo se permiten conversiones
 * técnicamente válidas: masa↔masa siempre; unidad↔masa con peso unitario;
 * volumen↔masa solo con densidad. Cualquier otra cosa devuelve un error
 * explícito en vez de un número inventado.
 */

export type MassUnit = "g" | "kg" | "mg";
export type VolumeUnit = "ml" | "l" | "tsp" | "tbsp" | "cup";
export type CountUnit = "unit";
export type QuantityUnit = MassUnit | VolumeUnit | CountUnit;

export interface Quantity {
  amount: number;
  unit: QuantityUnit;
}

const MASS_TO_G: Record<MassUnit, number> = { g: 1, kg: 1000, mg: 0.001 };
/** Medidas de cocina métricas (cucharadita 5 ml, cucharada 15 ml, taza 240 ml). */
const VOLUME_TO_ML: Record<VolumeUnit, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };

export type ConversionResult =
  | { ok: true; grams: number; exact: boolean }
  | { ok: false; reason: "missing_unit_weight" | "missing_density" | "invalid_amount" };

export function isMassUnit(u: QuantityUnit): u is MassUnit {
  return u in MASS_TO_G;
}
export function isVolumeUnit(u: QuantityUnit): u is VolumeUnit {
  return u in VOLUME_TO_ML;
}

export function toGrams(q: Quantity, ing: Pick<Ingredient, "unitWeightG" | "densityGPerMl">): ConversionResult {
  if (!Number.isFinite(q.amount) || q.amount < 0) return { ok: false, reason: "invalid_amount" };
  if (isMassUnit(q.unit)) return { ok: true, grams: q.amount * MASS_TO_G[q.unit], exact: true };
  if (isVolumeUnit(q.unit)) {
    if (!ing.densityGPerMl) return { ok: false, reason: "missing_density" };
    return { ok: true, grams: q.amount * VOLUME_TO_ML[q.unit] * ing.densityGPerMl, exact: false };
  }
  if (!ing.unitWeightG) return { ok: false, reason: "missing_unit_weight" };
  return { ok: true, grams: q.amount * ing.unitWeightG, exact: false };
}

/**
 * Convierte gramos entre estados usando el factor de rendimiento
 * (cocido = crudo × factor). Devuelve null si no hay factor: el llamador
 * decide si mostrar la línea por separado o pedir el dato.
 */
export function convertState(
  grams: number,
  from: FoodState,
  to: FoodState,
  yieldFactor: number | undefined,
): number | null {
  if (from === to) return grams;
  // "as_sold" se trata como crudo para efectos de compra (lo que trae el envase).
  const f = from === "as_sold" ? "raw" : from;
  const t = to === "as_sold" ? "raw" : to;
  if (f === t) return grams;
  if (!yieldFactor || yieldFactor <= 0) return null;
  return f === "raw" ? grams * yieldFactor : grams / yieldFactor;
}

/** Redondeo "de cocina": a múltiplos de `step`, sin bajar de 0. */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.max(0, Math.round(value / step) * step);
}
