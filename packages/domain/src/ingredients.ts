import type { Nutrients } from "./nutrients";
import type { Confidence, NutritionSource } from "./provenance";

/** Estado físico de una cantidad. Nunca se suman gramos de estados distintos. */
export type FoodState = "raw" | "cooked" | "as_sold";

export type IngredientCategory =
  | "carnes"
  | "pescados"
  | "huevos"
  | "lacteos"
  | "cereales"
  | "legumbres"
  | "verduras"
  | "frutas"
  | "grasas"
  | "frutos_secos"
  | "condimentos"
  | "panaderia"
  | "bebidas"
  | "otros";

export type ExchangeGroupCode =
  | "cereales"
  | "verduras_libre"
  | "verduras_general"
  | "frutas"
  | "carnes_altas_grasa"
  | "carnes_bajas_grasa"
  | "legumbres"
  | "lacteos_altos_grasa"
  | "lacteos_medios_grasa"
  | "lacteos_bajos_grasa"
  | "aceites_grasas"
  | "alimentos_ricos_lipidos"
  | "azucares";

export interface NutritionRow {
  per100g: Nutrients;
  source: NutritionSource;
  /** Identificador trazable en la fuente (p. ej. FDC ID, foto de etiqueta). */
  sourceRef: string | null;
  confidence: Confidence;
}

export interface Ingredient {
  id: string;
  name: string;
  category: IngredientCategory;
  /** Filas por estado. Que falte una fila es información, no un cero. */
  nutrition: Partial<Record<FoodState, NutritionRow>>;
  /** Gramos de una unidad (1 huevo, 1 pan). */
  unitWeightG?: number;
  /** g/ml, para convertir volúmenes de líquidos. */
  densityGPerMl?: number;
  /** Factor peso cocido / peso crudo por método (p. ej. arroz hervido ≈ 2,5). */
  yieldFactors?: Partial<Record<string, number>>;
  exchangeGroup?: ExchangeGroupCode;
  /** Gramos que equivalen a 1 porción de intercambio, en estado `exchangeState`. */
  exchangeGrams?: number;
  exchangeState?: FoodState;
  /** Etiquetas para restricciones (p. ej. "gluten", "lactosa", "mani"). */
  allergenTags?: string[];
}

export function nutritionFor(ing: Ingredient, state: FoodState): NutritionRow | undefined {
  return ing.nutrition[state];
}
