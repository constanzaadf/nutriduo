import {
  nutrientsForGrams,
  roundToStep,
  sumNutrients,
  weakest,
  type Confidence,
  type ExchangeGroupCode,
  type Nutrients,
} from "@nutriduo/domain";
import {
  DEFAULT_BOUNDS,
  DEFAULT_EXCHANGE_TOLERANCE,
  DEFAULT_MAX_PLATE_G,
  DEFAULT_ROUNDING,
  DEFAULT_TOLERANCES,
  defaultWeights,
} from "./defaults";
import { buildItems, type PortionItem } from "./items";
import { ModelBuilder, solveMilp } from "./lp";
import {
  PORTION_ENGINE_VERSION,
  type BindingConstraint,
  type Deviation,
  type PortionItemResult,
  type PortionRequest,
  type PortionResult,
  type PortionWarning,
  type PortionWeights,
} from "./types";

type MacroKey = "kcal" | "protein_g" | "carbs_g" | "fat_g";
const MACROS: { key: MacroKey; w: keyof Pick<PortionWeights, "kcal" | "protein" | "carbs" | "fat">; tol: "kcal" | "protein" | "carbs" | "fat" }[] = [
  { key: "kcal", w: "kcal", tol: "kcal" },
  { key: "protein_g", w: "protein", tol: "protein" },
  { key: "carbs_g", w: "carbs", tol: "carbs" },
  { key: "fat_g", w: "fat", tol: "fat" },
];

/** Hash FNV-1a de 32 bits, suficiente para identificar entradas en la traza. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stableHash(req: PortionRequest, items: PortionItem[]): string {
  const payload = {
    recipe: { id: req.recipe.id, lines: req.recipe.lines, homogeneous: req.recipe.isHomogeneous },
    target: req.target,
    goal: req.goal ?? null,
    weights: req.weights ?? null,
    restrictions: req.restrictions ?? null,
    preferences: req.preferences ?? null,
    extras: req.extras ?? null,
    skip: req.skipSideIngredientIds ?? null,
    maxPlate: req.maxPlateG ?? null,
    mix: req.mix ?? null,
    rounding: req.rounding ?? null,
    tolerances: req.tolerances ?? null,
    items: items.map((i) => [i.key, i.per100, i.exchangePerGram, i.lb, i.ub]),
  };
  return fnv1a(JSON.stringify(payload));
}

interface BuiltModel {
  mb: ModelBuilder;
  /** Por ítem: términos [variable, coeficiente] cuya suma da los gramos del ítem. */
  gramsExpr: [number, number][][];
  ratioVars: Map<string, number>;
  plateLabel: string;
}

function buildModel(items: PortionItem[], req: PortionRequest, weights: PortionWeights, hardExchangeTol: number | null): BuiltModel {
  const mb = new ModelBuilder();
  const gramsExpr: [number, number][][] = [];
  const ratioVars = new Map<string, number>();

  // Grupos de proporción: una escala por grupo
  for (const it of items) {
    if (it.ratioGroup && !ratioVars.has(it.ratioGroup)) {
      const [lo, hi] = DEFAULT_BOUNDS.ratio;
      const s = mb.addVar(`ratio:${it.ratioGroup}`, lo, hi);
      ratioVars.set(it.ratioGroup, s);
      // fidelidad del grupo: s − 1 = e⁺ − e⁻
      const ep = mb.addVar(`fid+:ratio:${it.ratioGroup}`, 0, Infinity, { cost: weights.fidelity });
      const em = mb.addVar(`fid-:ratio:${it.ratioGroup}`, 0, Infinity, { cost: weights.fidelity });
      mb.addConstraint([[s, 1], [ep, -1], [em, 1]], "=", 1);
    }
  }

  for (const it of items) {
    let expr: [number, number][];
    if (it.ratioGroup) {
      expr = [[ratioVars.get(it.ratioGroup)!, it.nominal]];
    } else if (it.integerUnitG) {
      const g = it.integerUnitG;
      let lo = Math.ceil(it.lb / g - 1e-9);
      let hi = Math.floor(it.ub / g + 1e-9);
      if (lo > hi) lo = hi = Math.max(1, Math.round(it.nominal / g));
      const u = mb.addVar(`units:${it.key}`, lo, hi, { integer: true });
      expr = [[u, g]];
    } else {
      const x = mb.addVar(`g:${it.key}`, it.lb, it.ub);
      expr = [[x, 1]];
    }
    gramsExpr.push(expr);

    const fixed = it.lb === it.ub;
    if (!fixed && !it.ratioGroup) {
      const scale = Math.max(it.nominal, 1);
      const ep = mb.addVar(`fid+:${it.key}`, 0, Infinity, { cost: weights.fidelity / scale });
      const em = mb.addVar(`fid-:${it.key}`, 0, Infinity, { cost: weights.fidelity / scale });
      mb.addConstraint([...expr, [ep, -1], [em, 1]], "=", it.nominal);
    }
    if (it.preference !== 0 && !fixed) {
      const scale = Math.max(it.nominal, 1);
      for (const [v, c] of expr) mb.addCost(v, (weights.preference * it.preference * c) / scale);
    }
  }

  // Objetivo nutricional
  if (req.target.mode === "macros") {
    const budget = req.target.budget;
    for (const m of MACROS) {
      const T = budget[m.key];
      const norm = Math.max(T, 1);
      const [wo, wu] = weights[m.w];
      const dp = mb.addVar(`dev+:${m.key}`, 0, Infinity, { cost: wo / norm });
      const dm = mb.addVar(`dev-:${m.key}`, 0, Infinity, { cost: wu / norm });
      const terms: [number, number][] = [];
      items.forEach((it, i) => {
        const perG = it.per100[m.key] / 100;
        if (perG !== 0) for (const [v, c] of gramsExpr[i]!) terms.push([v, c * perG]);
      });
      mb.addConstraint([...terms, [dp, -1], [dm, 1]], "=", T, `macro:${m.key}`);
    }
  } else {
    const groups = new Set<ExchangeGroupCode>(Object.keys(req.target.portions) as ExchangeGroupCode[]);
    for (const it of items) for (const g of Object.keys(it.exchangePerGram) as ExchangeGroupCode[]) groups.add(g);
    for (const g of [...groups].sort()) {
      const T = req.target.portions[g] ?? 0;
      const norm = Math.max(T, 1);
      const [wo, wu] = weights.exchange;
      const cap = hardExchangeTol ?? Infinity;
      const dp = mb.addVar(`dev+:${g}`, 0, cap, { cost: wo / norm });
      const dm = mb.addVar(`dev-:${g}`, 0, cap, { cost: wu / norm });
      const terms: [number, number][] = [];
      items.forEach((it, i) => {
        const perG = it.exchangePerGram[g] ?? 0;
        if (perG !== 0) for (const [v, c] of gramsExpr[i]!) terms.push([v, c * perG]);
      });
      mb.addConstraint([...terms, [dp, -1], [dm, 1]], "=", T, `exchange:${g}`);
    }
  }

  // Porción máxima razonable del plato
  const maxPlate = req.maxPlateG ?? DEFAULT_MAX_PLATE_G;
  const plateTerms: [number, number][] = [];
  items.forEach((it, i) => {
    for (const [v, c] of gramsExpr[i]!) plateTerms.push([v, c * it.plateFactor]);
  });
  mb.addConstraint(plateTerms, "<=", maxPlate, "plate");

  return { mb, gramsExpr, ratioVars, plateLabel: "plate" };
}

function evalExpr(expr: [number, number][], x: number[]): number {
  return expr.reduce((a, [v, c]) => a + c * x[v]!, 0);
}

function stepFor(it: PortionItem, rounding: typeof DEFAULT_ROUNDING): number {
  if (it.integerUnitG) return 0; // ya entero
  if (it.kind === "mix") return rounding.mix;
  if (it.isFat) return rounding.fats;
  if (it.nominal < 15) return rounding.small;
  return rounding.default;
}

function roundWithin(value: number, step: number, lb: number, ub: number): { grams: number; moved: boolean } {
  if (step <= 0) return { grams: value, moved: false };
  let r = roundToStep(value, step);
  if (r > ub + 1e-9) r = Math.floor(ub / step) * step;
  if (r < lb - 1e-9) r = Math.ceil(lb / step) * step;
  if (r > ub + 1e-9 || r < lb - 1e-9) return { grams: Math.min(ub, Math.max(lb, value)), moved: true };
  return { grams: r, moved: false };
}

function emptyResult(req: PortionRequest, status: PortionResult["status"], hash: string): PortionResult {
  return {
    participantId: req.participantId,
    status,
    items: [],
    nutrients: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 },
    exchanges: {},
    plateWeightG: 0,
    deviations: {},
    binding: [],
    warnings: [],
    confidence: "estimated",
    trace: { engineVersion: PORTION_ENGINE_VERSION, inputHash: hash, solverNodes: 0, objective: NaN },
  };
}

/**
 * Asigna la porción de UN participante para una receta. Determinista: la
 * misma solicitud produce exactamente el mismo resultado.
 */
export function solvePortions(req: PortionRequest): PortionResult {
  const built = buildItems(req);
  const hash = stableHash(req, built.items);

  if (built.blockedBy.length > 0) {
    return { ...emptyResult(req, "blocked_by_restriction", hash), blockedBy: built.blockedBy };
  }
  if (built.missing.length > 0) {
    return { ...emptyResult(req, "missing_data", hash), missing: built.missing };
  }
  const items = built.items;
  if (items.length === 0) return emptyResult(req, "infeasible", hash);

  const weights: PortionWeights = { ...defaultWeights(req.goal), ...req.weights };
  const tolerances = { ...DEFAULT_TOLERANCES, ...req.tolerances };
  const rounding = { ...DEFAULT_ROUNDING, ...req.rounding };
  const warnings: PortionWarning[] = [];

  if (req.target.mode === "exchanges" && items.some((i) => !i.hasExchangeInfo)) {
    const missing = items.filter((i) => !i.hasExchangeInfo).map((i) => ({ ingredientId: i.ingredientId ?? i.key, reason: "sin equivalencia de intercambio utilizable" }));
    return { ...emptyResult(req, "missing_data", hash), missing };
  }

  // Resolver (en modo pauta, primero con la tolerancia como restricción dura)
  const exTol = req.target.mode === "exchanges" ? req.target.tolerance ?? DEFAULT_EXCHANGE_TOLERANCE : null;
  let model = buildModel(items, req, weights, exTol);
  let sol = solveMilp(model.mb.build());
  let outsidePrescribed = false;
  if (sol.status === "infeasible" && exTol !== null) {
    outsidePrescribed = true;
    model = buildModel(items, req, weights, null);
    sol = solveMilp(model.mb.build());
  }
  if (sol.status === "node_limit") {
    warnings.push({ code: "node_limit", message: "La búsqueda de unidades enteras llegó a su límite; se muestra la mejor solución encontrada." });
  }
  if (sol.status !== "optimal" && sol.status !== "node_limit") {
    const res = emptyResult(req, "infeasible", hash);
    const minPlate = items.reduce((a, it) => a + it.lb * it.plateFactor, 0);
    const maxPlate = req.maxPlateG ?? DEFAULT_MAX_PLATE_G;
    if (minPlate > maxPlate) {
      res.binding.push({ kind: "plate_max", message: `Las cantidades mínimas ya superan la porción máxima del plato (${Math.round(minPlate)} g > ${maxPlate} g).` });
    }
    return res;
  }

  // Gramos antes de redondear (para explicar restricciones activas)
  const raw = items.map((_, i) => evalExpr(model.gramsExpr[i]!, sol.x));
  const binding: BindingConstraint[] = [];
  items.forEach((it, i) => {
    if (it.lb === it.ub) return;
    const g = raw[i]!;
    if (it.ratioGroup) return;
    if (g >= it.ub - 1e-6) binding.push({ kind: "item_max", key: it.key, message: `${it.label} llegó a su máximo razonable (${Math.round(it.ub)} g).` });
    else if (g <= it.lb + 1e-6) binding.push({ kind: "item_min", key: it.key, message: `${it.label} quedó en su mínimo (${Math.round(it.lb)} g).` });
  });
  for (const [group, v] of model.ratioVars) {
    const s = sol.x[v]!;
    const [lo, hi] = DEFAULT_BOUNDS.ratio;
    if (s >= hi - 1e-6) binding.push({ kind: "ratio_max", key: group, message: `La preparación "${group}" llegó al doble de la receta.` });
    else if (s <= lo + 1e-6) binding.push({ kind: "ratio_min", key: group, message: `La preparación "${group}" quedó en la mitad de la receta.` });
  }
  const maxPlate = req.maxPlateG ?? DEFAULT_MAX_PLATE_G;
  const rawPlate = items.reduce((a, it, i) => a + raw[i]! * it.plateFactor, 0);
  if (rawPlate >= maxPlate - 0.5) binding.push({ kind: "plate_max", message: `Se alcanzó la porción máxima razonable del plato (${maxPlate} g).` });

  // Redondeo de cocina; los grupos de proporción se redondean por ítem
  const results: PortionItemResult[] = items.map((it, i) => {
    let grams: number;
    let units: number | undefined;
    if (it.integerUnitG) {
      units = Math.round(raw[i]! / it.integerUnitG);
      grams = units * it.integerUnitG;
    } else {
      const r = roundWithin(raw[i]!, stepFor(it, rounding), it.ratioGroup ? 0 : it.lb, it.ratioGroup ? Infinity : it.ub);
      grams = r.grams;
      if (r.moved && !warnings.some((w) => w.code === "rounding_moved_bounds")) {
        warnings.push({ code: "rounding_moved_bounds", message: "Algún ingrediente no se pudo redondear a la medida de cocina sin salir de sus límites; se dejó el valor exacto." });
      }
    }
    const out: PortionItemResult = {
      key: it.key,
      label: it.label,
      ingredientId: it.ingredientId,
      kind: it.kind,
      grams,
      state: it.state,
      nutrients: nutrientsForGrams(it.per100, grams),
    };
    if (units !== undefined) out.units = units;
    return out;
  });

  const nutrients = sumNutrients(results.map((r) => r.nutrients));
  const exchanges: Partial<Record<ExchangeGroupCode, number>> = {};
  items.forEach((it, i) => {
    for (const [g, v] of Object.entries(it.exchangePerGram) as [ExchangeGroupCode, number][]) {
      exchanges[g] = (exchanges[g] ?? 0) + v * results[i]!.grams;
    }
  });
  const plateWeightG = items.reduce((a, it, i) => a + results[i]!.grams * it.plateFactor, 0);

  // Desviaciones post-redondeo (lo que se muestra es lo redondeado)
  const deviations: Partial<Record<string, Deviation>> = {};
  let allWithin = true;
  if (req.target.mode === "macros") {
    for (const m of MACROS) {
      const T = req.target.budget[m.key];
      const actual = nutrients[m.key];
      const abs = actual - T;
      const rel = T > 0 ? abs / T : 0;
      const within = Math.abs(rel) <= tolerances[m.tol] + 1e-9;
      if (!within) allWithin = false;
      deviations[m.key] = { target: T, actual, abs, rel, withinTolerance: within };
    }
  } else {
    const tol = exTol ?? DEFAULT_EXCHANGE_TOLERANCE;
    const groups = new Set<string>([...Object.keys(req.target.portions), ...Object.keys(exchanges)]);
    for (const g of [...groups].sort()) {
      const T = req.target.portions[g as ExchangeGroupCode] ?? 0;
      const actual = exchanges[g as ExchangeGroupCode] ?? 0;
      const abs = actual - T;
      const within = Math.abs(abs) <= tol + 1e-9;
      if (!within) allWithin = false;
      deviations[g] = { target: T, actual, abs, rel: T > 0 ? abs / T : 0, withinTolerance: within };
    }
    if (outsidePrescribed) {
      binding.push({ kind: "prescribed_tolerance", message: `Con esta receta no se puede cumplir la pauta dentro de ±${String(tol).replace(".", ",")} porciones por grupo; se muestra la combinación más cercana.` });
    }
  }

  let confidence: Confidence = weakest(...items.map((i) => i.confidence));
  if (built.mixEstimated && items.some((i) => i.kind === "mix")) {
    confidence = "estimated";
    warnings.push({ code: "mix_weight_estimated", message: "El peso cocido de la preparación es estimado; pesa la olla para que las porciones sean exactas." });
  }
  if (items.some((i) => i.state === "raw" && i.plateFactor === 1 && i.kind !== "mix")) {
    warnings.push({ code: "plate_weight_estimated", message: "El peso del plato es aproximado: algunos ingredientes crudos no tienen rendimiento de cocción cargado." });
  }

  const status: PortionResult["status"] = outsidePrescribed
    ? "outside_prescribed_tolerance"
    : allWithin
      ? "within_tolerance"
      : "with_deviation";

  // Desvío sin límites activos: viene de la composición de la receta, no de un tope.
  if (status === "with_deviation" && binding.length === 0) {
    const names: Record<string, string> = { kcal: "energía", protein_g: "proteína", carbs_g: "carbohidratos", fat_g: "grasas" };
    const off = Object.entries(deviations)
      .filter(([, d]) => d && !d.withinTolerance)
      .map(([k, d]) => `${names[k] ?? k} ${d!.abs > 0 ? "+" : "−"}${Math.round(Math.abs(d!.rel) * 100)} %`);
    binding.push({
      kind: "composition_tradeoff",
      message: `La composición de la receta no permite cumplir todo a la vez (${off.join(", ")}). Acercarse más alejaría otro nutriente de su meta; se priorizó según el objetivo del perfil.`,
    });
  }

  return {
    participantId: req.participantId,
    status,
    items: results,
    nutrients,
    exchanges,
    plateWeightG,
    deviations,
    binding: status === "within_tolerance" ? [] : binding,
    warnings,
    confidence,
    trace: { engineVersion: PORTION_ENGINE_VERSION, inputHash: hash, solverNodes: sol.nodes, objective: sol.objective },
  };
}
