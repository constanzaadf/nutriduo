import type {
  Confidence,
  ExchangeGroupCode,
  FoodState,
  Ingredient,
  Nutrients,
  RecipeIngredientLine,
  RecipeVersion,
} from "@nutriduo/domain";
import type { ExchangePortions, GoalType } from "@nutriduo/nutrition-engine";

export const PORTION_ENGINE_VERSION = "1.0.0";

export interface MacroBudget {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export type PortionTarget =
  | { mode: "macros"; budget: MacroBudget }
  | { mode: "exchanges"; portions: ExchangePortions; /** ± porciones por grupo (por defecto 0,25). */ tolerance?: number };

/** [peso por exceso, peso por déficit] */
export type AsymmetricWeight = readonly [over: number, under: number];

export interface PortionWeights {
  kcal: AsymmetricWeight;
  protein: AsymmetricWeight;
  carbs: AsymmetricWeight;
  fat: AsymmetricWeight;
  /** Peso de los grupos de intercambio (modo pauta). */
  exchange: AsymmetricWeight;
  /** λ: penaliza alejarse de la receta nominal. */
  fidelity: number;
  /** μ: penaliza ingredientes que no le gustan / premia los que sí. */
  preference: number;
}

export interface Restrictions {
  /** Etiquetas de alérgenos o exclusiones (p. ej. "gluten", "mani"). Restricción dura. */
  allergenTags: string[];
  excludedIngredientIds: string[];
}

/** Información de una preparación homogénea ya cocinada (o por cocinar). */
export interface MixInfo {
  /** Ingredientes crudos que entraron a la olla (cantidad total, no por porción). */
  rawLines: { ingredientId: string; grams: number; state: FoodState }[];
  /** Peso cocido total de esa olla. */
  cookedTotalG: number;
  /** true si se pesó; false si es estimado (rendimientos por defecto). */
  measured: boolean;
}

export interface RoundingSteps {
  default: number;
  fats: number;
  mix: number;
  small: number;
}

export interface Tolerances {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface PortionRequest {
  participantId: string;
  recipe: RecipeVersion;
  ingredients: ReadonlyMap<string, Ingredient>;
  target: PortionTarget;
  goal?: GoalType;
  weights?: Partial<PortionWeights>;
  restrictions?: Restrictions;
  /** Preferencia por ingrediente en [-1, 1]: 1 = no le gusta, -1 = le gusta mucho. */
  preferences?: Record<string, number>;
  /** Acompañamientos exclusivos de este participante (modalidad C). */
  extras?: RecipeIngredientLine[];
  /** Acompañamientos de la receta que este participante no come (solo rol "side"). */
  skipSideIngredientIds?: string[];
  /** Porción máxima razonable del plato, en gramos cocidos estimados. */
  maxPlateG?: number;
  mix?: MixInfo;
  rounding?: Partial<RoundingSteps>;
  tolerances?: Partial<Tolerances>;
}

export type PortionStatus =
  | "within_tolerance"
  | "with_deviation"
  | "outside_prescribed_tolerance"
  | "blocked_by_restriction"
  | "missing_data"
  | "infeasible";

export interface PortionItemResult {
  key: string;
  label: string;
  /** null para la mezcla de una preparación homogénea. */
  ingredientId: string | null;
  kind: "line" | "mix" | "extra";
  grams: number;
  state: FoodState;
  units?: number;
  nutrients: Nutrients;
}

export interface Deviation {
  target: number;
  actual: number;
  /** actual − target */
  abs: number;
  /** abs / target (0 si target = 0) */
  rel: number;
  withinTolerance: boolean;
}

export interface BindingConstraint {
  kind: "item_max" | "item_min" | "plate_max" | "ratio_max" | "ratio_min" | "prescribed_tolerance" | "composition_tradeoff";
  key?: string;
  message: string;
}

export interface PortionWarning {
  code:
    | "mix_weight_estimated"
    | "items_without_exchange_group"
    | "node_limit"
    | "plate_weight_estimated"
    | "rounding_moved_bounds";
  message: string;
}

export interface PortionResult {
  participantId: string;
  status: PortionStatus;
  items: PortionItemResult[];
  nutrients: Nutrients;
  /** Porciones de intercambio aportadas (siempre calculadas si hay datos). */
  exchanges: Partial<Record<ExchangeGroupCode, number>>;
  plateWeightG: number;
  deviations: Partial<Record<string, Deviation>>;
  binding: BindingConstraint[];
  blockedBy?: { ingredientId: string; reason: string }[];
  missing?: { ingredientId: string; reason: string }[];
  warnings: PortionWarning[];
  confidence: Confidence;
  trace: { engineVersion: string; inputHash: string; solverNodes: number; objective: number };
}
