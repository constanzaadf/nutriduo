/** Filas de la base que la app usa (escritas a mano a partir de las migraciones). */

export type Slot = "breakfast" | "snack_am" | "lunch" | "snack_pm" | "dinner" | "extra";
export type Mode = "A" | "B" | "C";
export type VisibilityLevel = "private" | "summary" | "full";

export interface Household {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  invite_code: string | null;
  max_members: number;
}

export interface Person {
  profile_id: string;
  display_name: string;
  user_id: string | null;
  is_me: boolean;
  my_view_level: VisibilityLevel;
}

export interface ProfileRow {
  id: string;
  household_id: string;
  user_id: string | null;
  display_name: string;
  birth_date: string | null;
  equation_constant: "male" | "female" | "average" | null;
  height_cm: number | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  target_weight_kg: number | null;
  daily_activity: "sedentary" | "office_walking" | "standing" | "physical" | null;
  daily_pal_override: number | null;
  work_type: string | null;
  training: { label: string; met: number; minutes: number; daysOfWeek: number[]; resistance?: boolean }[];
  goal_type: "fat_loss" | "recomposition" | "muscle_gain" | "maintenance" | "balanced" | "custom" | null;
  goal_note: string | null;
  clinical_flags: string[];
  cooking_preferences: string | null;
  professional_notes: string | null;
}

export interface GoalRow {
  id: string;
  profile_id: string;
  mode: "macros" | "exchanges";
  source: "calculated" | "prescribed" | "manual";
  confidence: "prescribed" | "calculated" | "estimated";
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  exchange_portions: Record<string, number> | null;
  by_weekday: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }[] | null;
  prescribed_by: string | null;
  valid_from: string;
}

export interface SlotTargetRow {
  slot: Slot;
  kcal_share: number;
  exchange_portions: Record<string, number> | null;
}

export interface IngredientRow {
  id: string;
  household_id: string | null;
  name: string;
  category: string;
  default_state: "raw" | "cooked" | "as_sold";
  unit_weight_g: number | null;
  density_g_per_ml: number | null;
  exchange_group_code: string | null;
  exchange_grams: number | null;
  exchange_state: "raw" | "cooked" | "as_sold" | null;
  allergen_tags: string[];
}

export interface NutritionRowDb {
  ingredient_id: string;
  state: "raw" | "cooked" | "as_sold";
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number | null;
  source: "fdc" | "label" | "manual" | "exchange_table";
  source_ref: string | null;
  confidence: "prescribed" | "calculated" | "estimated";
}

export interface RecipeRow {
  id: string;
  household_id: string;
  name: string;
  category: string;
  tags: string[];
  photo_path: string | null;
  prep_minutes: number | null;
  favorite: boolean;
  archived: boolean;
  current_version_id: string | null;
}

export interface RecipeVersionRow {
  id: string;
  recipe_id: string;
  parent_version_id: string | null;
  version_no: number;
  origin: "original" | "optimized" | "manual";
  name: string;
  servings_nominal: number;
  is_homogeneous: boolean;
  expected_cooked_yield_g: number | null;
  instructions: string | null;
  change_log: { change: string; why: string }[];
  created_at: string;
}

export interface RecipeLineRow {
  version_id: string;
  position: number;
  ingredient_id: string;
  grams: number;
  state: "raw" | "cooked" | "as_sold";
  role: "fixed" | "adjustable" | "ratio" | "side";
  min_g: number | null;
  max_g: number | null;
  ratio_group: string | null;
  integer_unit_g: number | null;
  note: string | null;
}

export interface MealEventRow {
  id: string;
  plan_id: string;
  household_id: string;
  date: string;
  slot: Slot;
  mode: Mode;
  recipe_version_id: string | null;
  batch_id: string | null;
  plan_status: "draft" | "approved" | "eaten_out" | "cancelled";
  prep_status: "pending" | "prepared";
  cook_servings: number | null;
  row_version: number;
  notes: string | null;
}

export interface ParticipantRow {
  id: string;
  event_id: string;
  profile_id: string;
  date: string;
  slot: Slot;
  active: boolean;
  options: ParticipantOptions;
}

export interface ParticipantOptions {
  extras?: { ingredient_id: string; grams: number; state: "raw" | "cooked" | "as_sold"; integer_unit_g?: number | null }[];
  skip_sides?: string[];
}

export interface PortionRow {
  id: string;
  participant_id: string;
  status: string;
  confidence: "prescribed" | "calculated" | "estimated";
  total_g: number;
  plate_g: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  budget: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  deviations: Record<string, { target: number; actual: number; abs: number; rel: number; withinTolerance: boolean }> | null;
  explanations: string[];
}

export interface PortionLineRow {
  portion_id: string;
  ingredient_id: string | null;
  kind: "line" | "mix" | "extra";
  label: string;
  grams: number;
  state: "raw" | "cooked" | "as_sold";
  units: number | null;
}

export interface ConsumptionRow {
  id: string;
  profile_id: string;
  date: string;
  slot: Slot;
  event_id: string | null;
  kind: "as_planned" | "modified_portion" | "different_meal" | "eaten_out" | "skipped";
  portion_factor: number | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  confidence: "prescribed" | "calculated" | "estimated";
  free_text: string | null;
}

export interface BatchRow {
  id: string;
  household_id: string;
  recipe_version_id: string;
  status: "planned" | "cooked" | "finished" | "discarded";
  planned_for: string | null;
  cooked_on: string | null;
  raw_input: { ingredientId: string; grams: number; state: "raw" | "cooked" | "as_sold" }[];
  expected_cooked_g: number | null;
  cooked_total_g: number | null;
  measured: boolean;
  location: "fridge" | "freezer" | "pantry";
  frozen: boolean;
  use_by: string | null;
}

export interface ShoppingItemRow {
  id: string;
  list_id: string;
  key: string;
  ingredient_id: string | null;
  label: string;
  category: string;
  state: "raw" | "cooked" | "as_sold" | null;
  need_g: number;
  available_g: number;
  buy_g: number;
  checked: boolean;
  checked_g: number;
  manual: boolean;
  manual_quantity: string | null;
  source_hash: string | null;
  pack_suggestion: { packs: { label: string; grams: number; count: number }[]; totalG: number; surplusG: number } | null;
  estimated_price: number | null;
  position: number;
}

export interface InventoryRow {
  id: string;
  household_id: string;
  ingredient_id: string;
  grams: number;
  state: "raw" | "cooked" | "as_sold";
  location: "pantry" | "fridge" | "freezer";
  expires_on: string | null;
  opened: boolean;
}

/** Supabase devuelve numeric como string: normalizar a número. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return NaN;
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}
