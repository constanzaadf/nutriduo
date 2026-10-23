import { sumNutrients, type Ingredient, type Nutrients, type RecipeVersion } from "@nutriduo/domain";
import { SLOT_LABEL_ES, type GoalType, type MealSlot } from "@nutriduo/nutrition-engine";
import { fnv1a, nominalMix, solvePortions, type PortionResult, type PortionTarget, type Restrictions } from "@nutriduo/portion-engine";

/**
 * Menú semanal con cocina del domingo.
 *
 * Determinista: con la misma entrada (incluida la semilla) produce la misma
 * propuesta. No inventa cantidades: cada porción sale del motor de porciones
 * con el presupuesto de cada persona, y el tamaño de cada olla es la suma de
 * esas porciones más un margen.
 *
 * Reglas:
 * - Los tiempos marcados "batch" se cubren con preparaciones homogéneas
 *   (guisos, legumbres, salsas) cocinadas el día de cocina, rotando entre
 *   varias ollas para que no se repita el plato en comidas seguidas.
 * - Lo que se come más de `fridgeDays` días después de cocinar se congela
 *   el mismo día de cocina (refrigerado: 3 días por defecto).
 * - Los tiempos "fresh" se cocinan ese día, con tope de minutos distinto en
 *   semana y fin de semana, evitando repetir platos y proteína del día.
 * - Una receta que bloquea a cualquiera de los participantes (alergia,
 *   exclusión) o que no tiene porción factible no se propone.
 */

export const MENU_ENGINE_VERSION = "1.0.0";

export type SlotSource = "batch" | "fresh";
export type SlotKind = "breakfast" | "main" | "snack";

export interface PlanSlot {
  date: string; // YYYY-MM-DD
  slot: MealSlot;
  source: SlotSource;
}

export interface MenuParticipant {
  id: string;
  /** Presupuesto por tiempo de comida. Sin entrada para un tiempo = no participa en él. */
  targets: Partial<Record<MealSlot, PortionTarget>>;
  /** Presupuestos que cambian por fecha (metas por día de la semana). */
  targetsByDate?: Record<string, Partial<Record<MealSlot, PortionTarget>>>;
  goal?: GoalType;
  restrictions?: Restrictions;
  preferences?: Record<string, number>;
}

export interface MenuRecipe {
  recipeId: string;
  version: RecipeVersion;
  category: string;
  prepMinutes: number | null;
  favorite?: boolean;
}

export interface PantryItem {
  ingredientId: string;
  grams: number;
  expiresOn: string | null;
}

export interface MenuOptions {
  /** Ollas distintas para las comidas principales de la semana (por defecto 3). */
  batchCount?: number;
  /** Días que una preparación se guarda refrigerada antes de tener que congelarla (por defecto 3). */
  fridgeDays?: number;
  /** Tope de preparación para lo que se cocina en el día, lunes a viernes (por defecto 25 min). */
  quickMinutes?: number;
  /** Tope de preparación sábado y domingo (por defecto 90 min). */
  weekendMinutes?: number;
  /** Tope para desayunos de lunes a viernes (por defecto 10 min). */
  weekdayBreakfastMinutes?: number;
  /** Margen sobre la suma de porciones al dimensionar cada olla (por defecto 8 %: variación normal al cocinar y ajustes al aprobar). */
  batchMargin?: number;
  /** Cambia la propuesta entre recetas de puntaje parecido ("otra propuesta"). */
  seed?: number;
}

export interface MenuRequest {
  cookDate: string;
  slots: PlanSlot[];
  participants: MenuParticipant[];
  recipes: MenuRecipe[];
  ingredients: ReadonlyMap<string, Ingredient>;
  /** Recetas comidas en las últimas semanas (se penalizan levemente). */
  recentRecipeIds?: string[];
  pantry?: PantryItem[];
  options?: MenuOptions;
}

export interface ProposedPortion {
  participantId: string;
  status: PortionResult["status"];
  nutrients: Nutrients;
  /** Gramos de preparación terminada que salen de la olla (solo comidas de lote). */
  mixG: number | null;
  /** Acompañamientos que esta persona no come (por alergia o exclusión). */
  skipSides: string[];
}

export interface ProposedEvent {
  date: string;
  slot: MealSlot;
  source: SlotSource;
  /** A = misma receta para todos; C = alguien omite un acompañamiento. */
  mode: "A" | "C";
  recipeId: string;
  versionId: string;
  name: string;
  /** Clave del lote (solo source = batch). */
  batchKey: string | null;
  storage: "fridge" | "freezer" | null;
  participantIds: string[];
  portions: ProposedPortion[];
  why: string[];
}

export interface ProposedBatch {
  key: string;
  recipeId: string;
  versionId: string;
  name: string;
  cookDate: string;
  kind: SlotKind;
  meals: number;
  /** Gramos cocidos que se reparten en comidas, refrigerados y congelados. */
  fridgeG: number;
  freezerG: number;
  /** Total a cocinar (incluye margen). */
  cookedTotalG: number;
  /** Factor sobre la receta nominal y porciones nominales equivalentes. */
  scale: number;
  servingsEquivalent: number;
  rawLines: { ingredientId: string; grams: number; state: RecipeVersion["lines"][number]["state"] }[];
  /** Acompañamientos de todas sus comidas (arroz, fideos…): no van en la olla; se cocinan en el día o también el domingo. */
  sides: { ingredientId: string; grams: number; state: RecipeVersion["lines"][number]["state"] }[];
  useByFridge: string;
}

export interface DaySummary {
  date: string;
  participantId: string;
  planned: Nutrients;
  /** Suma de presupuestos de los tiempos planificados (null si la pauta es por porciones). */
  budget: { kcal: number; protein_g: number } | null;
  meals: number;
}

export interface MenuProposal {
  events: ProposedEvent[];
  batches: ProposedBatch[];
  days: DaySummary[];
  unfilled: { date: string; slot: MealSlot; reason: string }[];
  notes: string[];
  trace: { engineVersion: string; inputHash: string; seed: number; evaluations: number };
}

// ───────────── utilidades ─────────────

const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, snack_am: 1, lunch: 2, snack_pm: 3, dinner: 4, extra: 5 };
export const SLOT_KIND: Record<MealSlot, SlotKind> = {
  breakfast: "breakfast",
  snack_am: "snack",
  lunch: "main",
  snack_pm: "snack",
  dinner: "main",
  extra: "snack",
};
/** Categorías de receta aceptadas por tiempo de comida; la primera es la preferida. */
export const SLOT_POOLS: Record<MealSlot, string[]> = {
  breakfast: ["desayunos"],
  snack_am: ["snacks"],
  lunch: ["almuerzos", "cenas"],
  snack_pm: ["snacks", "postres"],
  dinner: ["cenas", "almuerzos"],
  extra: ["postres", "snacks"],
};

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export function isWeekend(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}
const chrono = (a: { date: string; slot: MealSlot }, b: { date: string; slot: MealSlot }) =>
  a.date === b.date ? SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] : a.date < b.date ? -1 : 1;
const unit = (s: string) => parseInt(fnv1a(s), 16) / 0x1_0000_0000;
const round5 = (g: number) => Math.max(5, Math.round(g / 5) * 5);

const PROTEIN_CATEGORIES = new Set(["carnes", "pescados", "huevos", "legumbres", "lacteos"]);

/** Proteína principal de una receta: el ingrediente que más proteína aporta. */
export function primaryProtein(v: RecipeVersion, ings: ReadonlyMap<string, Ingredient>): { ingredientId: string | null; group: string } {
  let best: { id: string; p: number; ing: Ingredient } | null = null;
  for (const l of v.lines) {
    const ing = ings.get(l.ingredientId);
    if (!ing || !PROTEIN_CATEGORIES.has(ing.category)) continue;
    const p = ((ing.nutrition[l.state]?.per100g.protein_g ?? 0) * l.grams) / 100;
    if (!best || p > best.p) best = { id: ing.id, p, ing };
  }
  if (!best) return { ingredientId: null, group: "vegetal" };
  const g = best.ing.category === "carnes" ? (/pollo/i.test(best.ing.name) ? "pollo" : "carne") : best.ing.category;
  return { ingredientId: best.id, group: g };
}

const STATUS_COST: Partial<Record<PortionResult["status"], number>> = {
  within_tolerance: 0,
  with_deviation: 0.6,
  outside_prescribed_tolerance: 1.5,
};

// ───────────── motor ─────────────

export function planWeek(req: MenuRequest): MenuProposal {
  const o = {
    batchCount: req.options?.batchCount ?? 3,
    fridgeDays: req.options?.fridgeDays ?? 3,
    quickMinutes: req.options?.quickMinutes ?? 25,
    weekendMinutes: req.options?.weekendMinutes ?? 90,
    weekdayBreakfastMinutes: req.options?.weekdayBreakfastMinutes ?? 10,
    batchMargin: req.options?.batchMargin ?? 0.08,
    seed: req.options?.seed ?? 0,
  };
  const ings = req.ingredients;
  const notes: string[] = [];
  const unfilled: MenuProposal["unfilled"] = [];
  let evaluations = 0;

  const recent = new Set(req.recentRecipeIds ?? []);
  const proteins = new Map(req.recipes.map((r) => [r.recipeId, primaryProtein(r.version, ings)]));
  const pantryIds = new Set((req.pantry ?? []).filter((p) => p.grams > 0).map((p) => p.ingredientId));
  const expiring = new Set(
    (req.pantry ?? []).filter((p) => p.grams > 0 && p.expiresOn && daysBetween(req.cookDate, p.expiresOn) <= 5).map((p) => p.ingredientId),
  );

  const targetFor = (p: MenuParticipant, slot: MealSlot, date: string | null) => (date ? p.targetsByDate?.[date]?.[slot] : undefined) ?? p.targets[slot];
  const eaters = (slot: MealSlot) => req.participants.filter((p) => p.targets[slot]);

  // Porciones de cada persona para una receta en un tiempo (y fecha) dados.
  const portionCache = new Map<string, PortionResult[] | string>();
  const skipped = new Map<string, string[]>();
  const skipsOf = (r: MenuRecipe, slot: MealSlot, date: string | null, pid: string) => skipped.get(`${r.recipeId}|${slot}|${date ?? "*"}|${pid}`) ?? [];
  const toPortion = (r: MenuRecipe, slot: MealSlot, date: string, pr: PortionResult, mix: boolean): ProposedPortion => ({
    participantId: pr.participantId,
    status: pr.status,
    nutrients: pr.nutrients,
    mixG: mix ? (pr.items.find((i) => i.kind === "mix")?.grams ?? 0) : null,
    skipSides: skipsOf(r, slot, date, pr.participantId),
  });

  function portions(r: MenuRecipe, slot: MealSlot, date: string | null): PortionResult[] | string {
    const key = `${r.recipeId}|${slot}|${date ?? "*"}`;
    const hit = portionCache.get(key);
    if (hit !== undefined) return hit;
    const out: PortionResult[] = [];
    let res: PortionResult[] | string = out;
    for (const p of eaters(slot)) {
      const target = targetFor(p, slot, date)!;
      const solve = (skip: string[]) => {
        evaluations++;
        return solvePortions({
          participantId: p.id,
          recipe: r.version,
          ingredients: ings,
          target,
          ...(p.goal ? { goal: p.goal } : {}),
          ...(p.restrictions ? { restrictions: p.restrictions } : {}),
          ...(p.preferences ? { preferences: p.preferences } : {}),
          ...(skip.length ? { skipSideIngredientIds: skip } : {}),
        });
      };
      let pr = solve([]);
      // Si lo que bloquea es solo un acompañamiento, esa persona lo omite (modalidad C)
      if (pr.status === "blocked_by_restriction") {
        const sides = new Set(r.version.lines.filter((l) => l.role === "side").map((l) => l.ingredientId));
        const blockers = [...new Set((pr.blockedBy ?? []).map((b) => b.ingredientId))];
        if (blockers.length && blockers.every((id) => sides.has(id))) {
          const retry = solve(blockers);
          if (retry.status !== "blocked_by_restriction") pr = retry;
          skipped.set(`${key}|${p.id}`, blockers);
        }
      }
      if (STATUS_COST[pr.status] === undefined) {
        res =
          pr.status === "blocked_by_restriction"
            ? "no compatible con las restricciones de alguien"
            : pr.status === "missing_data"
              ? "faltan datos nutricionales"
              : "no hay porción razonable para alguien";
        break;
      }
      out.push(pr);
    }
    portionCache.set(key, res);
    return res;
  }

  function fitCost(r: MenuRecipe, slot: MealSlot): number | null {
    const ps = portions(r, slot, null);
    if (typeof ps === "string") return null;
    if (ps.length === 0) return 0;
    let total = 0;
    for (const pr of ps) {
      const devs = Object.values(pr.deviations).filter((d) => d !== undefined);
      const dev = devs.length ? devs.reduce((a, d) => a + Math.min(Math.abs(d!.rel), 1), 0) / devs.length : 0;
      total += STATUS_COST[pr.status]! + 2 * dev;
    }
    return total / ps.length;
  }

  function baseAdjust(r: MenuRecipe, slot: MealSlot, salt: string): number {
    let s = 0.15 * unit(`${o.seed}|${r.recipeId}|${salt}`);
    if (recent.has(r.recipeId)) s += 0.5;
    if (r.favorite) s -= 0.2;
    if (SLOT_POOLS[slot][0] !== r.category) s += 0.25;
    if (pantryIds.size) {
      const lines = r.version.lines.filter((l) => ings.get(l.ingredientId)?.category !== "condimentos");
      const present = lines.filter((l) => pantryIds.has(l.ingredientId)).length;
      if (lines.length) s -= 0.4 * (present / lines.length);
      if (lines.some((l) => expiring.has(l.ingredientId))) s -= 0.5;
    }
    return s;
  }

  const nobody = [...new Set(req.slots.filter((s) => eaters(s.slot).length === 0).map((s) => s.slot))];
  if (nobody.length) notes.push(`Nadie tiene presupuesto para ${nobody.map((s) => SLOT_LABEL_ES[s].toLowerCase()).join(", ")} en su meta: esos tiempos no se planifican.`);
  const slots = req.slots.filter((s) => eaters(s.slot).length > 0).map((s) => ({ ...s })).sort(chrono);
  const dupes = new Set<string>();
  for (const s of slots) {
    const k = `${s.date}|${s.slot}`;
    if (dupes.has(k)) throw new RangeError(`Tiempo repetido: ${k}`);
    dupes.add(k);
  }

  const events: ProposedEvent[] = [];
  const batches: ProposedBatch[] = [];

  // ── 1. Ollas del día de cocina ──
  const batchSlots = slots.filter((s) => s.source === "batch");
  for (const kind of ["main", "breakfast", "snack"] as SlotKind[]) {
    const kSlots = batchSlots.filter((s) => SLOT_KIND[s.slot] === kind);
    if (kSlots.length === 0) continue;
    const slotTypes = [...new Set(kSlots.map((s) => s.slot))];
    const lateSlot = kSlots.find((s) => daysBetween(req.cookDate, s.date) < 1);
    if (lateSlot) throw new RangeError(`El lote se cocina el ${req.cookDate}: no puede cubrir el ${lateSlot.date}`);

    const scored: { r: MenuRecipe; cost: number }[] = [];
    for (const r of req.recipes) {
      if (!r.version.isHomogeneous) continue;
      if (!slotTypes.every((st) => SLOT_POOLS[st].includes(r.category))) continue;
      const costs = slotTypes.map((st) => fitCost(r, st));
      if (costs.some((c) => c === null)) continue;
      const cost = costs.reduce<number>((a, c) => a + c!, 0) / costs.length + slotTypes.reduce((a, st) => a + baseAdjust(r, st, `batch|${kind}`), 0) / slotTypes.length;
      scored.push({ r, cost });
    }
    const wanted = Math.min(kind === "main" ? Math.max(1, o.batchCount) : 1, kSlots.length);
    if (scored.length < wanted) {
      notes.push(
        scored.length === 0
          ? `No hay preparaciones para cocinar en lote que sirvan a todos en ${kind === "main" ? "almuerzos y cenas" : kind === "breakfast" ? "desayunos" : "colaciones"}; esos tiempos quedan para cocinar en el día.`
          : `Solo ${scored.length} preparación(es) en lote sirven para todos; se repiten más de lo ideal.`,
      );
    }
    const chosen: MenuRecipe[] = [];
    const pool = [...scored];
    while (chosen.length < wanted && pool.length) {
      let bestI = 0;
      let bestC = Infinity;
      pool.forEach((c, i) => {
        const pp = proteins.get(c.r.recipeId)!;
        let pen = 0;
        for (const ch of chosen) {
          const q = proteins.get(ch.recipeId)!;
          if (pp.ingredientId && pp.ingredientId === q.ingredientId) pen += 1.5;
          else if (pp.group === q.group) pen += 0.6;
        }
        if (c.cost + pen < bestC) {
          bestC = c.cost + pen;
          bestI = i;
        }
      });
      chosen.push(pool.splice(bestI, 1)[0]!.r);
    }
    if (chosen.length === 0) {
      // Se cocinan en el día
      for (const s of kSlots) s.source = "fresh";
      continue;
    }

    // Rotación: comidas seguidas nunca repiten la misma olla (con 2 o más ollas)
    const assigned = new Map<string, PlanSlot[]>();
    kSlots.forEach((s, i) => {
      const r = chosen[i % chosen.length]!;
      assigned.set(r.recipeId, [...(assigned.get(r.recipeId) ?? []), s]);
    });

    for (const r of chosen) {
      const mine = assigned.get(r.recipeId) ?? [];
      const key = `lote-${kind}-${batches.length + 1}`;
      let fridgeG = 0;
      let freezerG = 0;
      const sides = new Map<string, ProposedBatch["sides"][number]>();
      for (const s of mine) {
        const ps = portions(r, s.slot, s.date);
        if (typeof ps !== "string") {
          for (const it of ps.flatMap((x) => x.items)) {
            if (it.kind !== "line" || !it.ingredientId) continue;
            const k = `${it.ingredientId}|${it.state}`;
            const prev = sides.get(k);
            if (prev) prev.grams += it.grams;
            else sides.set(k, { ingredientId: it.ingredientId, grams: it.grams, state: it.state });
          }
        }
        const storage = daysBetween(req.cookDate, s.date) <= o.fridgeDays ? "fridge" : "freezer";
        const pp: ProposedPortion[] = typeof ps === "string" ? [] : ps.map((pr) => toPortion(r, s.slot, s.date, pr, true));
        const g = pp.reduce((a, p) => a + (p.mixG ?? 0), 0);
        if (storage === "fridge") fridgeG += g;
        else freezerG += g;
        events.push({
          date: s.date,
          slot: s.slot,
          source: "batch",
          mode: pp.some((x) => x.skipSides.length) ? "C" : "A",
          recipeId: r.recipeId,
          versionId: r.version.id,
          name: r.version.name,
          batchKey: key,
          storage,
          participantIds: pp.map((p) => p.participantId),
          portions: pp,
          why: [
            storage === "fridge" ? `Sale de la olla del ${req.cookDate}, refrigerada.` : `Sale de la olla del ${req.cookDate}: congelar ese día y descongelar la noche anterior.`,
          ],
        });
      }
      const nominal = nominalMix(r.version, ings);
      const cookedTotalG = Math.ceil(((fridgeG + freezerG) * (1 + o.batchMargin)) / 10) * 10;
      const scale = nominal.cookedTotalG > 0 ? cookedTotalG / nominal.cookedTotalG : 0;
      batches.push({
        key,
        recipeId: r.recipeId,
        versionId: r.version.id,
        name: r.version.name,
        cookDate: req.cookDate,
        kind,
        meals: mine.length,
        fridgeG: Math.round(fridgeG),
        freezerG: Math.round(freezerG),
        cookedTotalG,
        scale: Math.round(scale * 100) / 100,
        servingsEquivalent: Math.round(r.version.servingsNominal * scale * 10) / 10,
        rawLines: nominal.rawLines.map((l) => ({ ingredientId: l.ingredientId, grams: round5(l.grams * scale), state: l.state })),
        sides: [...sides.values()].map((x) => ({ ...x, grams: Math.round(x.grams) })),
        useByFridge: addDays(req.cookDate, o.fridgeDays),
      });
    }
  }

  // ── 2. Lo que se cocina en el día ──
  const batchMainRecipes = new Set(batches.filter((b) => b.kind === "main").map((b) => b.recipeId));
  const freshSlots = slots.filter((s) => s.source === "fresh");
  for (const s of freshSlots) {
    const kind = SLOT_KIND[s.slot];
    const limit = isWeekend(s.date) ? o.weekendMinutes : kind === "breakfast" ? o.weekdayBreakfastMinutes : o.quickMinutes;
    const dayEvents = events.filter((e) => e.date === s.date && SLOT_KIND[e.slot] === "main");
    let best: { r: MenuRecipe; cost: number } | null = null;
    let reason = "ninguna receta del recetario sirve para este tiempo";
    let sawTime = false;
    for (const r of req.recipes) {
      if (!SLOT_POOLS[s.slot].includes(r.category)) continue;
      if (kind === "main" && batchMainRecipes.has(r.recipeId)) continue;
      if (r.prepMinutes != null && r.prepMinutes > limit) {
        sawTime = true;
        continue;
      }
      const c = fitCost(r, s.slot);
      if (c === null) continue;
      let cost = c + baseAdjust(r, s.slot, `${s.date}|${s.slot}`);
      const heavy = kind === "main";
      for (const e of events) {
        if (e.recipeId !== r.recipeId) continue;
        const gap = Math.abs(daysBetween(e.date, s.date));
        cost += gap <= 1 ? (heavy ? 2.5 : 0.8) : gap <= 2 ? (heavy ? 1.2 : 0.4) : heavy ? 0.5 : 0.15;
      }
      if (heavy) {
        const pp = proteins.get(r.recipeId)!;
        for (const e of dayEvents) {
          const q = proteins.get(e.recipeId)!;
          if (pp.ingredientId && pp.ingredientId === q.ingredientId) cost += 1;
          else if (pp.group === q.group) cost += 0.4;
        }
      }
      if (!best || cost < best.cost) best = { r, cost };
    }
    if (!best) {
      if (sawTime) reason = `ninguna receta compatible se prepara en ${limit} min o menos`;
      unfilled.push({ date: s.date, slot: s.slot, reason });
      continue;
    }
    const ps = portions(best.r, s.slot, s.date);
    const pp: ProposedPortion[] = typeof ps === "string" ? [] : ps.map((pr) => toPortion(best!.r, s.slot, s.date, pr, false));
    const why: string[] = [];
    if (best.r.prepMinutes != null) why.push(`${best.r.prepMinutes} min de preparación.`);
    if (best.r.version.lines.some((l) => expiring.has(l.ingredientId))) why.push("Usa algo del inventario que vence pronto.");
    events.push({
      date: s.date,
      slot: s.slot,
      source: "fresh",
      mode: pp.some((x) => x.skipSides.length) ? "C" : "A",
      recipeId: best.r.recipeId,
      versionId: best.r.version.id,
      name: best.r.version.name,
      batchKey: null,
      storage: null,
      participantIds: pp.map((p) => p.participantId),
      portions: pp,
      why,
    });
  }
  events.sort(chrono);

  // ── 3. Resumen por día y persona ──
  const days: DaySummary[] = [];
  const dates = [...new Set(slots.map((s) => s.date))].sort();
  for (const date of dates) {
    for (const p of req.participants) {
      const mine = events.filter((e) => e.date === date && e.participantIds.includes(p.id));
      if (mine.length === 0) continue;
      const planned = sumNutrients(mine.map((e) => e.portions.find((x) => x.participantId === p.id)!.nutrients));
      let budget: DaySummary["budget"] = { kcal: 0, protein_g: 0 };
      for (const e of mine) {
        const t = targetFor(p, e.slot, date);
        if (!t || t.mode !== "macros") {
          budget = null;
          break;
        }
        budget.kcal += t.budget.kcal;
        budget.protein_g += t.budget.protein_g;
      }
      days.push({ date, participantId: p.id, planned, budget, meals: mine.length });
    }
  }

  if (batches.some((b) => b.freezerG > 0)) {
    notes.push(`Las comidas más allá de ${o.fridgeDays} días desde la cocina se congelan el mismo día: la comida cocida dura 3 a 4 días refrigerada.`);
  }

  const inputHash = fnv1a(
    JSON.stringify({
      v: MENU_ENGINE_VERSION,
      c: req.cookDate,
      s: slots.map((s) => [s.date, s.slot, s.source]),
      p: req.participants.map((p) => [p.id, p.targets, p.targetsByDate ?? null, p.goal ?? null, p.restrictions ?? null, p.preferences ?? null]),
      r: req.recipes.map((r) => [r.recipeId, r.version.id, r.prepMinutes, r.favorite ?? false]),
      rec: [...recent].sort(),
      pan: req.pantry ?? [],
      o,
    }),
  );
  return { events, batches, days, unfilled, notes, trace: { engineVersion: MENU_ENGINE_VERSION, inputHash, seed: o.seed, evaluations } };
}

/** Tiempos por defecto para una semana que parte el lunes `monday`, con cocina el domingo anterior. */
export function defaultWeekSlots(
  monday: string,
  opts: { breakfast?: boolean; snacks?: boolean; weekdayDinner?: SlotSource; weekdayLunch?: SlotSource } = {},
): PlanSlot[] {
  const out: PlanSlot[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const weekend = i >= 5;
    if (opts.breakfast ?? true) out.push({ date, slot: "breakfast", source: "fresh" });
    out.push({ date, slot: "lunch", source: weekend ? "fresh" : (opts.weekdayLunch ?? "batch") });
    if (opts.snacks) out.push({ date, slot: "snack_pm", source: "fresh" });
    out.push({ date, slot: "dinner", source: weekend ? "fresh" : (opts.weekdayDinner ?? "batch") });
  }
  return out;
}
