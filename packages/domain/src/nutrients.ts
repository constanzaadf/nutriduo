/**
 * Aritmética de nutrientes. Todo se expresa en gramos de alimento y valores
 * absolutos (kcal, g, mg); los valores "por 100 g" solo existen en las tablas
 * de ingredientes y se convierten aquí, en un único lugar.
 */

export interface Nutrients {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  /** Opcional: muchas fuentes no lo traen. `null` = desconocido, no cero. */
  sodium_mg: number | null;
}

export const MACRO_KEYS = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

export function zeroNutrients(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

/** Suma dos vectores. El sodio queda desconocido si cualquiera lo es. */
export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
    fiber_g: a.fiber_g + b.fiber_g,
    sodium_mg: a.sodium_mg === null || b.sodium_mg === null ? null : a.sodium_mg + b.sodium_mg,
  };
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    kcal: n.kcal * factor,
    protein_g: n.protein_g * factor,
    carbs_g: n.carbs_g * factor,
    fat_g: n.fat_g * factor,
    fiber_g: n.fiber_g * factor,
    sodium_mg: n.sodium_mg === null ? null : n.sodium_mg * factor,
  };
}

export function sumNutrients(list: readonly Nutrients[]): Nutrients {
  return list.reduce<Nutrients>((acc, n) => addNutrients(acc, n), zeroNutrients());
}

/** Nutrientes aportados por `grams` de un alimento con valores por 100 g. */
export function nutrientsForGrams(per100g: Nutrients, grams: number): Nutrients {
  // Multiplicar antes de dividir evita errores de representación (350 × 70 / 100 = 245 exacto).
  const f = (v: number) => (v * grams) / 100;
  return {
    kcal: f(per100g.kcal),
    protein_g: f(per100g.protein_g),
    carbs_g: f(per100g.carbs_g),
    fat_g: f(per100g.fat_g),
    fiber_g: f(per100g.fiber_g),
    sodium_mg: per100g.sodium_mg === null ? null : f(per100g.sodium_mg),
  };
}

/**
 * Energía calculada desde macros con factores de Atwater generales
 * (4/4/9). Sirve para detectar filas de tabla inconsistentes, no para
 * reemplazar la energía declarada por la fuente.
 */
export function atwaterKcal(n: Pick<Nutrients, "protein_g" | "carbs_g" | "fat_g">): number {
  return n.protein_g * 4 + n.carbs_g * 4 + n.fat_g * 9;
}

/** Redondeo de presentación: kcal a 10, macros a 1 g bajo 10 g y a 5 g sobre. */
export function roundForDisplay(n: Nutrients): Nutrients {
  const g = (v: number) => (Math.abs(v) < 10 ? Math.round(v) : Math.round(v / 5) * 5);
  return {
    kcal: Math.round(n.kcal / 10) * 10,
    protein_g: g(n.protein_g),
    carbs_g: g(n.carbs_g),
    fat_g: g(n.fat_g),
    fiber_g: Math.round(n.fiber_g),
    sodium_mg: n.sodium_mg === null ? null : Math.round(n.sodium_mg / 10) * 10,
  };
}

export function assertFiniteNutrients(n: Nutrients, label = "nutrientes"): void {
  for (const k of MACRO_KEYS) {
    const v = n[k];
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`${label}: ${k} debe ser un número finito ≥ 0 (recibido ${v})`);
    }
  }
}
