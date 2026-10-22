import "server-only";
import type { ExchangeGroupCode, FoodState, Ingredient, RecipeVersion } from "@nutriduo/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { num, numOrNull, type IngredientRow, type NutritionRowDb, type RecipeLineRow, type RecipeVersionRow } from "../types";

type Db = SupabaseClient;

/** Ingredientes del dominio (con nutrición por estado y rendimientos) para los motores. */
export async function loadIngredients(db: Db, ids: string[]): Promise<Map<string, Ingredient>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, Ingredient>();
  if (unique.length === 0) return out;
  const [{ data: ings, error: e1 }, { data: rows, error: e2 }, { data: yields, error: e3 }] = await Promise.all([
    db.from("ingredients").select("*").in("id", unique),
    db.from("ingredient_nutrition").select("*").in("ingredient_id", unique),
    db.from("ingredient_yields").select("ingredient_id, method, yield_factor").in("ingredient_id", unique),
  ]);
  if (e1 || e2 || e3) throw new Error(`No se pudieron cargar ingredientes: ${(e1 ?? e2 ?? e3)!.message}`);
  for (const r of (ings ?? []) as IngredientRow[]) {
    const ing: Ingredient = {
      id: r.id,
      name: r.name,
      category: r.category as Ingredient["category"],
      nutrition: {},
      allergenTags: r.allergen_tags ?? [],
    };
    if (r.unit_weight_g) ing.unitWeightG = num(r.unit_weight_g);
    if (r.density_g_per_ml) ing.densityGPerMl = num(r.density_g_per_ml);
    if (r.exchange_group_code && r.exchange_grams) {
      ing.exchangeGroup = r.exchange_group_code as ExchangeGroupCode;
      ing.exchangeGrams = num(r.exchange_grams);
      ing.exchangeState = (r.exchange_state ?? r.default_state) as FoodState;
    }
    out.set(r.id, ing);
  }
  for (const n of (rows ?? []) as NutritionRowDb[]) {
    const ing = out.get(n.ingredient_id);
    if (!ing) continue;
    ing.nutrition[n.state] = {
      per100g: {
        kcal: num(n.kcal),
        protein_g: num(n.protein_g),
        carbs_g: num(n.carbs_g),
        fat_g: num(n.fat_g),
        fiber_g: num(n.fiber_g),
        sodium_mg: numOrNull(n.sodium_mg),
      },
      source: n.source,
      sourceRef: n.source_ref,
      confidence: n.confidence,
    };
  }
  for (const y of (yields ?? []) as { ingredient_id: string; method: string; yield_factor: unknown }[]) {
    const ing = out.get(y.ingredient_id);
    if (!ing) continue;
    ing.yieldFactors = { ...(ing.yieldFactors ?? {}), [y.method]: num(y.yield_factor) };
  }
  return out;
}

export async function loadRecipeVersion(db: Db, versionId: string): Promise<{ version: RecipeVersion; row: RecipeVersionRow; lines: RecipeLineRow[] }> {
  const [{ data: v, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
    db.from("recipe_versions").select("*").eq("id", versionId).single(),
    db.from("recipe_ingredients").select("*").eq("version_id", versionId).order("position"),
  ]);
  if (e1 || !v) throw new Error(`Versión de receta no encontrada: ${e1?.message ?? versionId}`);
  if (e2) throw new Error(e2.message);
  const row = v as RecipeVersionRow;
  const ls = (lines ?? []) as RecipeLineRow[];
  const version: RecipeVersion = {
    id: row.id,
    recipeId: row.recipe_id,
    parentVersionId: row.parent_version_id,
    origin: row.origin,
    name: row.name,
    servingsNominal: num(row.servings_nominal),
    isHomogeneous: row.is_homogeneous,
    lines: ls.map((l) => {
      const line: RecipeVersion["lines"][number] = {
        ingredientId: l.ingredient_id,
        grams: num(l.grams),
        state: l.state,
        role: l.role,
      };
      if (l.min_g != null) line.minG = num(l.min_g);
      if (l.max_g != null) line.maxG = num(l.max_g);
      if (l.ratio_group) line.ratioGroup = l.ratio_group;
      if (l.integer_unit_g != null) line.integerUnitG = num(l.integer_unit_g);
      return line;
    }),
  };
  if (row.expected_cooked_yield_g != null) version.expectedCookedYieldG = num(row.expected_cooked_yield_g);
  return { version, row, lines: ls };
}
