import {
  convertState,
  weakest,
  type Confidence,
  type ExchangeGroupCode,
  type FoodState,
  type Ingredient,
  type Nutrients,
  type RecipeIngredientLine,
  type RecipeVersion,
} from "@nutriduo/domain";
import { DEFAULT_BOUNDS } from "./defaults";
import type { MixInfo, PortionRequest } from "./types";

/**
 * Un "ítem" es cualquier cosa a la que el motor le asigna gramos: una línea
 * de receta separable, la mezcla de una preparación homogénea o un
 * acompañamiento exclusivo de un participante.
 */
export interface PortionItem {
  key: string;
  label: string;
  ingredientId: string | null;
  kind: "line" | "mix" | "extra";
  role: RecipeIngredientLine["role"] | "mix";
  state: FoodState;
  /** Nutrientes por 100 g en `state`. */
  per100: Nutrients;
  /** Porciones de intercambio por gramo, por grupo. */
  exchangePerGram: Partial<Record<ExchangeGroupCode, number>>;
  hasExchangeInfo: boolean;
  nominal: number;
  lb: number;
  ub: number;
  integerUnitG?: number;
  ratioGroup?: string;
  /** Gramos de plato (cocido estimado) por gramo de ítem. */
  plateFactor: number;
  preference: number;
  isFat: boolean;
  confidence: Confidence;
}

export interface BuildItemsResult {
  items: PortionItem[];
  blockedBy: { ingredientId: string; reason: string }[];
  missing: { ingredientId: string; reason: string }[];
  mixEstimated: boolean;
}

function defaultYield(ing: Ingredient): number | undefined {
  const y = ing.yieldFactors;
  if (!y) return undefined;
  if (y["default"]) return y["default"];
  const first = Object.keys(y).sort()[0];
  return first ? y[first] : undefined;
}

function plateFactorFor(ing: Ingredient, state: FoodState): number {
  if (state === "cooked") return 1;
  return defaultYield(ing) ?? 1;
}

function exchangePerGramFor(ing: Ingredient, state: FoodState): { map: Partial<Record<ExchangeGroupCode, number>>; ok: boolean } {
  if (!ing.exchangeGroup) return { map: {}, ok: true }; // alimento sin grupo (condimento, agua): aporta 0
  if (!ing.exchangeGrams || ing.exchangeGrams <= 0) return { map: {}, ok: false };
  const exState = ing.exchangeState ?? state;
  const gramsInExState = convertState(1, state, exState, defaultYield(ing));
  if (gramsInExState === null) return { map: {}, ok: false };
  return { map: { [ing.exchangeGroup]: gramsInExState / ing.exchangeGrams }, ok: true };
}

function restrictionHit(ing: Ingredient, req: PortionRequest): string | null {
  const r = req.restrictions;
  if (!r) return null;
  if (r.excludedIngredientIds.includes(ing.id)) return "excluido por indicación";
  const tags = new Set((ing.allergenTags ?? []).map((t) => t.toLowerCase()));
  const hit = r.allergenTags.find((t) => tags.has(t.toLowerCase()));
  return hit ? `contiene ${hit}` : null;
}

function boundsFor(line: RecipeIngredientLine, kind: "line" | "extra"): [number, number] {
  const n = line.grams;
  if (line.role === "fixed") return [n, n];
  const mult =
    kind === "extra" ? DEFAULT_BOUNDS.extra : line.role === "side" ? DEFAULT_BOUNDS.side : DEFAULT_BOUNDS.adjustable;
  const lb = line.minG ?? n * mult[0];
  const ub = line.maxG ?? n * mult[1];
  return [Math.min(lb, ub), Math.max(lb, ub)];
}

/** Línea de receta o extra → ítem. */
function lineItem(
  line: RecipeIngredientLine,
  index: number,
  kind: "line" | "extra",
  req: PortionRequest,
  out: BuildItemsResult,
): PortionItem | null {
  const ing = req.ingredients.get(line.ingredientId);
  if (!ing) {
    out.missing.push({ ingredientId: line.ingredientId, reason: "ingrediente no encontrado" });
    return null;
  }
  const hit = restrictionHit(ing, req);
  if (hit) {
    out.blockedBy.push({ ingredientId: ing.id, reason: hit });
    return null;
  }
  const row = ing.nutrition[line.state];
  if (!row) {
    out.missing.push({ ingredientId: ing.id, reason: `sin datos nutricionales en estado ${line.state}` });
    return null;
  }
  const ex = exchangePerGramFor(ing, line.state);
  const [lb, ub] = boundsFor(line, kind);
  const item: PortionItem = {
    key: `${kind}:${index}:${ing.id}`,
    label: ing.name,
    ingredientId: ing.id,
    kind,
    role: line.role,
    state: line.state,
    per100: row.per100g,
    exchangePerGram: ex.map,
    hasExchangeInfo: ex.ok,
    nominal: line.grams,
    lb,
    ub,
    plateFactor: plateFactorFor(ing, line.state),
    preference: req.preferences?.[ing.id] ?? 0,
    isFat: ing.category === "grasas",
    confidence: row.confidence,
  };
  if (line.integerUnitG) item.integerUnitG = line.integerUnitG;
  if (line.ratioGroup && line.role === "ratio") item.ratioGroup = line.ratioGroup;
  return item;
}

/** Información de mezcla derivada de la receta nominal cuando no viene de un lote. */
export function nominalMix(recipe: RecipeVersion, ingredients: ReadonlyMap<string, Ingredient>): MixInfo {
  const mixLines = recipe.lines.filter((l) => l.role !== "side");
  const rawLines = mixLines.map((l) => ({ ingredientId: l.ingredientId, grams: l.grams * recipe.servingsNominal, state: l.state }));
  if (recipe.expectedCookedYieldG && recipe.expectedCookedYieldG > 0) {
    return { rawLines, cookedTotalG: recipe.expectedCookedYieldG, measured: false };
  }
  let cooked = 0;
  for (const l of rawLines) {
    const ing = ingredients.get(l.ingredientId);
    cooked += l.grams * (ing ? plateFactorFor(ing, l.state) : 1);
  }
  return { rawLines, cookedTotalG: cooked, measured: false };
}

function mixItem(req: PortionRequest, out: BuildItemsResult): PortionItem | null {
  const recipe = req.recipe;
  const mix = req.mix ?? nominalMix(recipe, req.ingredients);
  out.mixEstimated = !mix.measured;
  if (!(mix.cookedTotalG > 0)) {
    out.missing.push({ ingredientId: recipe.id, reason: "peso cocido de la preparación desconocido" });
    return null;
  }
  const total: Nutrients = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
  const exTotal: Partial<Record<ExchangeGroupCode, number>> = {};
  let exOk = true;
  let conf: Confidence = mix.measured ? "calculated" : "estimated";
  let ok = true;
  for (const l of mix.rawLines) {
    const ing = req.ingredients.get(l.ingredientId);
    if (!ing) {
      out.missing.push({ ingredientId: l.ingredientId, reason: "ingrediente no encontrado" });
      ok = false;
      continue;
    }
    const hit = restrictionHit(ing, req);
    if (hit) {
      out.blockedBy.push({ ingredientId: ing.id, reason: hit });
      ok = false;
      continue;
    }
    const row = ing.nutrition[l.state];
    if (!row) {
      out.missing.push({ ingredientId: ing.id, reason: `sin datos nutricionales en estado ${l.state}` });
      ok = false;
      continue;
    }
    const f = l.grams / 100;
    total.kcal += row.per100g.kcal * f;
    total.protein_g += row.per100g.protein_g * f;
    total.carbs_g += row.per100g.carbs_g * f;
    total.fat_g += row.per100g.fat_g * f;
    total.fiber_g += row.per100g.fiber_g * f;
    total.sodium_mg = total.sodium_mg === null || row.per100g.sodium_mg === null ? null : total.sodium_mg + row.per100g.sodium_mg * f;
    const ex = exchangePerGramFor(ing, l.state);
    if (!ex.ok) exOk = false;
    for (const [g, v] of Object.entries(ex.map) as [ExchangeGroupCode, number][]) {
      exTotal[g] = (exTotal[g] ?? 0) + v * l.grams;
    }
    conf = weakest(conf, row.confidence);
  }
  if (!ok) return null;

  const per100: Nutrients = {
    kcal: (total.kcal / mix.cookedTotalG) * 100,
    protein_g: (total.protein_g / mix.cookedTotalG) * 100,
    carbs_g: (total.carbs_g / mix.cookedTotalG) * 100,
    fat_g: (total.fat_g / mix.cookedTotalG) * 100,
    fiber_g: (total.fiber_g / mix.cookedTotalG) * 100,
    sodium_mg: total.sodium_mg === null ? null : (total.sodium_mg / mix.cookedTotalG) * 100,
  };
  const exchangePerGram: Partial<Record<ExchangeGroupCode, number>> = {};
  for (const [g, v] of Object.entries(exTotal) as [ExchangeGroupCode, number][]) {
    exchangePerGram[g] = v / mix.cookedTotalG;
  }

  // Porción nominal: cuántas porciones de receta contiene esta olla
  const recipeRawPerServing = recipe.lines.filter((l) => l.role !== "side").reduce((a, l) => a + l.grams, 0);
  const potRaw = mix.rawLines.reduce((a, l) => a + l.grams, 0);
  const servingsInPot = recipeRawPerServing > 0 ? potRaw / recipeRawPerServing : recipe.servingsNominal;
  const nominal = mix.cookedTotalG / Math.max(servingsInPot, 1e-9);
  const [m0, m1] = DEFAULT_BOUNDS.mix;
  return {
    key: `mix:${recipe.id}`,
    label: recipe.name,
    ingredientId: null,
    kind: "mix",
    role: "mix",
    state: "cooked",
    per100,
    exchangePerGram,
    hasExchangeInfo: exOk,
    nominal,
    lb: nominal * m0,
    ub: Math.min(nominal * m1, mix.cookedTotalG),
    plateFactor: 1,
    preference: 0,
    isFat: false,
    confidence: conf,
  };
}

export function buildItems(req: PortionRequest): BuildItemsResult {
  const out: BuildItemsResult = { items: [], blockedBy: [], missing: [], mixEstimated: false };
  const skip = new Set(req.skipSideIngredientIds ?? []);
  const recipe = req.recipe;

  if (recipe.isHomogeneous) {
    const m = mixItem(req, out);
    if (m) out.items.push(m);
    recipe.lines.forEach((l, i) => {
      if (l.role !== "side" || skip.has(l.ingredientId)) return;
      const it = lineItem(l, i, "line", req, out);
      if (it) out.items.push(it);
    });
  } else {
    recipe.lines.forEach((l, i) => {
      if (l.role === "side" && skip.has(l.ingredientId)) return;
      const it = lineItem(l, i, "line", req, out);
      if (it) out.items.push(it);
    });
  }
  (req.extras ?? []).forEach((l, i) => {
    const it = lineItem(l, i, "extra", req, out);
    if (it) out.items.push(it);
  });
  return out;
}
