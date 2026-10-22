import type { ExchangeGroupCode } from "@nutriduo/domain";
import type { MacroTarget } from "./compute";

/**
 * Pautas por porciones de intercambio. Los aportes por grupo varían entre
 * tablas y profesionales, así que la tabla por defecto es solo un punto de
 * partida rotulado como estimado: al importar una pauta se reemplaza por los
 * valores que esa pauta declara.
 */

export interface ExchangeGroupValue {
  code: ExchangeGroupCode;
  label: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Valores de uso habitual en pautas chilenas. Verificar contra la pauta real. */
export const DEFAULT_EXCHANGE_TABLE: Record<ExchangeGroupCode, ExchangeGroupValue> = {
  cereales: { code: "cereales", label: "Cereales, papas y legumbres frescas", kcal: 140, protein_g: 3, carbs_g: 30, fat_g: 1 },
  verduras_general: { code: "verduras_general", label: "Verduras de consumo general", kcal: 30, protein_g: 2, carbs_g: 5, fat_g: 0 },
  verduras_libre: { code: "verduras_libre", label: "Verduras de libre consumo", kcal: 10, protein_g: 1, carbs_g: 2.5, fat_g: 0 },
  frutas: { code: "frutas", label: "Frutas", kcal: 65, protein_g: 1, carbs_g: 15, fat_g: 0 },
  carnes_altas_grasa: { code: "carnes_altas_grasa", label: "Carnes altas en grasa", kcal: 120, protein_g: 11, carbs_g: 1, fat_g: 8 },
  carnes_bajas_grasa: { code: "carnes_bajas_grasa", label: "Carnes bajas en grasa", kcal: 65, protein_g: 11, carbs_g: 1, fat_g: 2 },
  legumbres: { code: "legumbres", label: "Leguminosas", kcal: 170, protein_g: 11, carbs_g: 30, fat_g: 1 },
  lacteos_altos_grasa: { code: "lacteos_altos_grasa", label: "Lácteos altos en grasa", kcal: 110, protein_g: 5, carbs_g: 9, fat_g: 6 },
  lacteos_medios_grasa: { code: "lacteos_medios_grasa", label: "Lácteos medios en grasa", kcal: 85, protein_g: 5, carbs_g: 9, fat_g: 3 },
  lacteos_bajos_grasa: { code: "lacteos_bajos_grasa", label: "Lácteos bajos en grasa", kcal: 70, protein_g: 7, carbs_g: 10, fat_g: 0 },
  aceites_grasas: { code: "aceites_grasas", label: "Aceites y grasas", kcal: 180, protein_g: 0, carbs_g: 0, fat_g: 20 },
  alimentos_ricos_lipidos: { code: "alimentos_ricos_lipidos", label: "Alimentos ricos en lípidos", kcal: 175, protein_g: 3, carbs_g: 5, fat_g: 15 },
  azucares: { code: "azucares", label: "Azúcares", kcal: 20, protein_g: 0, carbs_g: 5, fat_g: 0 },
};

export type ExchangePortions = Partial<Record<ExchangeGroupCode, number>>;

/** Macros derivados de un conjunto de porciones de intercambio. */
export function macrosFromExchanges(
  portions: ExchangePortions,
  table: Record<ExchangeGroupCode, ExchangeGroupValue> = DEFAULT_EXCHANGE_TABLE,
): MacroTarget {
  let kcal = 0, protein = 0, carbs = 0, fat = 0;
  for (const [code, n] of Object.entries(portions) as [ExchangeGroupCode, number][]) {
    if (!Number.isFinite(n) || n < 0) throw new RangeError(`Porciones inválidas para ${code}: ${n}`);
    const g = table[code];
    kcal += g.kcal * n;
    protein += g.protein_g * n;
    carbs += g.carbs_g * n;
    fat += g.fat_g * n;
  }
  return { kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, fiber_g: (kcal / 1000) * 14 };
}

/** Suma de porciones de varios tiempos de comida (una pauta diaria). */
export function addPortions(...list: ExchangePortions[]): ExchangePortions {
  const out: ExchangePortions = {};
  for (const p of list) {
    for (const [k, v] of Object.entries(p) as [ExchangeGroupCode, number][]) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}
