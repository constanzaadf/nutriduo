import type { FoodState } from "./ingredients";

/**
 * Rol de un ingrediente dentro de una versión de receta. Lo usa el motor
 * de porciones para decidir qué puede mover y cómo.
 *  - fixed:      cantidad fija por porción (especias, sal); escala con la porción base.
 *  - adjustable: el motor puede subirla o bajarla entre min y max.
 *  - ratio:      pertenece a un grupo de proporción (salsa, aliño); se mueve en bloque.
 *  - side:       acompañamiento que puede ser exclusivo de un participante.
 */
export type IngredientRole = "fixed" | "adjustable" | "ratio" | "side";

export interface RecipeIngredientLine {
  ingredientId: string;
  /** Gramos por porción nominal, en `state`. */
  grams: number;
  state: FoodState;
  role: IngredientRole;
  minG?: number;
  maxG?: number;
  /** Grupo de proporción (mismo id = se escalan juntos). */
  ratioGroup?: string;
  /** Si se compra/porciona en unidades enteras (1 huevo = 55 g). */
  integerUnitG?: number;
}

export interface RecipeVersion {
  id: string;
  recipeId: string;
  parentVersionId: string | null;
  origin: "original" | "optimized" | "manual";
  name: string;
  servingsNominal: number;
  /** Mezcla que no se puede separar después de cocinar (guiso, salsa, sopa). */
  isHomogeneous: boolean;
  lines: RecipeIngredientLine[];
  /** Peso cocido esperado de TODA la receta (servingsNominal porciones), si se conoce. */
  expectedCookedYieldG?: number;
}
