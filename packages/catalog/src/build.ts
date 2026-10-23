import type { ExchangeGroupCode, FoodState, Ingredient, NutritionRow } from "@nutriduo/domain";
import { DEFAULT_EXCHANGE_TABLE } from "@nutriduo/nutrition-engine";
import extract from "../data/sr28-extract.json" with { type: "json" };
import { CATALOG_INGREDIENTS, type CatalogIngredientDef } from "./ingredients";

export interface Sr28Row {
  ndb: string;
  description: string;
  water_g: number | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  household_weights: { grams: number; measure: string }[];
}

export const SR28 = extract as unknown as { source: string; file_sha256: string; rows: Record<string, Sr28Row> };

/** Nutriente que define cada grupo de intercambio, y su valor por porción en la tabla por defecto. */
const EXCHANGE_BASIS: Record<ExchangeGroupCode, "carbs_g" | "protein_g" | "fat_g" | "kcal"> = {
  cereales: "carbs_g",
  verduras_general: "carbs_g",
  verduras_libre: "carbs_g",
  frutas: "carbs_g",
  legumbres: "carbs_g",
  azucares: "carbs_g",
  carnes_bajas_grasa: "protein_g",
  carnes_altas_grasa: "protein_g",
  lacteos_bajos_grasa: "kcal",
  lacteos_medios_grasa: "kcal",
  lacteos_altos_grasa: "kcal",
  aceites_grasas: "fat_g",
  alimentos_ricos_lipidos: "fat_g",
};

export interface BuiltCatalogIngredient {
  def: CatalogIngredientDef;
  nutrition: Partial<Record<FoodState, NutritionRow>>;
  sr: { main: Sr28Row; cooked: Sr28Row | null };
  yieldFactor: number | null;
  exchangeGrams: number | null;
  /** Ingrediente del dominio, con id = slug (para probar los motores). */
  ingredient: Ingredient;
}

function req(row: Sr28Row, k: keyof Sr28Row): number {
  const v = row[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`SR28 ${row.ndb}: falta ${String(k)}`);
  return v;
}

function nutritionRow(row: Sr28Row): NutritionRow {
  return {
    per100g: {
      kcal: req(row, "kcal"),
      protein_g: req(row, "protein_g"),
      carbs_g: req(row, "carbs_g"),
      fat_g: req(row, "fat_g"),
      // SR28 deja la fibra en blanco cuando no la analizó; se usa 0 (no aporta al cálculo de macros).
      fiber_g: row.fiber_g ?? 0,
      sodium_mg: row.sodium_mg,
    },
    source: "fdc",
    sourceRef: `USDA SR28 NDB ${row.ndb}: ${row.description}`,
    confidence: "calculated",
  };
}

function round(v: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function buildCatalogIngredient(def: CatalogIngredientDef): BuiltCatalogIngredient {
  const main = SR28.rows[def.ndb];
  if (!main) throw new Error(`${def.slug}: NDB ${def.ndb} no está en el extracto`);
  const cooked = def.cookedNdb ? SR28.rows[def.cookedNdb] ?? null : null;
  if (def.cookedNdb && !cooked) throw new Error(`${def.slug}: NDB cocido ${def.cookedNdb} no está en el extracto`);

  const nutrition: Partial<Record<FoodState, NutritionRow>> = { [def.state]: nutritionRow(main) };
  if (cooked) nutrition.cooked = nutritionRow(cooked);

  let yieldFactor: number | null = null;
  if (cooked && def.yield === "dry_matter") {
    yieldFactor = (100 - req(main, "water_g")) / (100 - req(cooked, "water_g"));
  } else if (cooked && def.yield === "protein") {
    yieldFactor = req(main, "protein_g") / req(cooked, "protein_g");
  }
  if (yieldFactor !== null) {
    yieldFactor = round(yieldFactor, 2);
    if (yieldFactor < 0.4 || yieldFactor > 7) throw new Error(`${def.slug}: rendimiento fuera de rango (${yieldFactor})`);
  }

  let exchangeGrams: number | null = null;
  if (def.exchange) {
    const basis = EXCHANGE_BASIS[def.exchange];
    const perPortion = DEFAULT_EXCHANGE_TABLE[def.exchange][basis];
    const per100 = nutrition[def.state]!.per100g[basis];
    if (!per100 || per100 <= 0) throw new Error(`${def.slug}: no aporta ${basis}, no puede estar en ${def.exchange}`);
    exchangeGrams = round((perPortion / per100) * 100, 0);
  }

  if (def.unitG !== undefined) {
    const ok = main.household_weights.some((w) => Math.abs(w.grams - def.unitG!) < 0.01);
    if (!ok) throw new Error(`${def.slug}: el peso por unidad ${def.unitG} g no figura en SR28 ${def.ndb}`);
  }

  const ingredient: Ingredient = {
    id: def.slug,
    name: def.name,
    category: def.category,
    nutrition,
    allergenTags: def.allergens ?? [],
  };
  if (def.unitG !== undefined) ingredient.unitWeightG = def.unitG;
  if (yieldFactor !== null) ingredient.yieldFactors = { default: yieldFactor };
  if (def.exchange && exchangeGrams) {
    ingredient.exchangeGroup = def.exchange;
    ingredient.exchangeGrams = exchangeGrams;
    ingredient.exchangeState = def.state;
  }
  return { def, nutrition, sr: { main, cooked }, yieldFactor, exchangeGrams, ingredient };
}

let cache: Map<string, BuiltCatalogIngredient> | null = null;

export function buildCatalog(): Map<string, BuiltCatalogIngredient> {
  if (cache) return cache;
  const out = new Map<string, BuiltCatalogIngredient>();
  for (const def of CATALOG_INGREDIENTS) {
    if (out.has(def.slug)) throw new Error(`Slug duplicado: ${def.slug}`);
    out.set(def.slug, buildCatalogIngredient(def));
  }
  const names = new Set<string>();
  for (const b of out.values()) {
    const k = b.def.name.toLowerCase();
    if (names.has(k)) throw new Error(`Nombre duplicado: ${b.def.name}`);
    names.add(k);
  }
  cache = out;
  return out;
}

export function catalogIngredientMap(): Map<string, Ingredient> {
  return new Map([...buildCatalog().entries()].map(([k, v]) => [k, v.ingredient]));
}
