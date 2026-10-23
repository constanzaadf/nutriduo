import "server-only";
import { DEFAULT_SLOT_SHARES, slotBudget, type GoalType, type MacroTarget, type MealSlot, type SlotShares } from "@nutriduo/nutrition-engine";
import type { PortionTarget, Restrictions } from "@nutriduo/portion-engine";
import type { SupabaseClient } from "@supabase/supabase-js";
import { weekdayIndex } from "../dates";
import { num, type GoalRow, type Slot, type SlotTargetRow } from "../types";

export interface ParticipantInputs {
  profileId: string;
  goalType: GoalType;
  daily: MacroTarget | null;
  target: PortionTarget | null;
  restrictions: Restrictions;
  preferences: Record<string, number>;
  /** Por qué no hay presupuesto (sin meta vigente, etc.). */
  problem: string | null;
  goalSource: GoalRow["source"] | null;
}

const EXTRA_SHARE = 0.1;

/**
 * Presupuesto de un participante para un tiempo de comida, más sus
 * restricciones y preferencias. Usa el cliente admin: se llama solo después
 * de verificar que quien pide el cálculo pertenece al mismo hogar.
 */
export interface ProfileGoalData {
  profileId: string;
  goalType: GoalType;
  restrictions: Restrictions;
  preferences: Record<string, number>;
  goal: GoalRow | null;
  slots: SlotTargetRow[];
  shares: SlotShares;
}

/** Meta vigente, reparto por tiempos, restricciones y preferencias de un perfil (una sola carga). */
export async function loadProfileGoalData(admin: SupabaseClient, profileId: string): Promise<ProfileGoalData> {
  const [{ data: profile }, { data: goal }, { data: restr }, { data: prefs }] = await Promise.all([
    admin.from("nutrition_profiles").select("goal_type").eq("id", profileId).single(),
    admin.from("nutrition_goals").select("*").eq("profile_id", profileId).is("valid_to", null).maybeSingle(),
    admin.from("dietary_restrictions").select("ingredient_id, tag, severity").eq("profile_id", profileId),
    admin.from("dietary_preferences").select("ingredient_id, score").eq("profile_id", profileId).not("ingredient_id", "is", null),
  ]);

  const restrictions: Restrictions = { allergenTags: [], excludedIngredientIds: [] };
  const preferences: Record<string, number> = {};
  for (const r of (restr ?? []) as { ingredient_id: string | null; tag: string | null; severity: string }[]) {
    if (r.severity === "avoid") {
      if (r.ingredient_id) preferences[r.ingredient_id] = 1;
      continue;
    }
    if (r.ingredient_id) restrictions.excludedIngredientIds.push(r.ingredient_id);
    if (r.tag) restrictions.allergenTags.push(r.tag);
  }
  for (const p of (prefs ?? []) as { ingredient_id: string; score: unknown }[]) preferences[p.ingredient_id] = num(p.score);

  const goalType = ((profile?.goal_type as GoalType | null) ?? "maintenance") as GoalType;
  let slots: SlotTargetRow[] = [];
  if (goal) {
    const { data: slotRows } = await admin.from("meal_slot_targets").select("slot, kcal_share, exchange_portions").eq("goal_id", (goal as GoalRow).id);
    slots = (slotRows ?? []) as SlotTargetRow[];
  }
  const shares: SlotShares = slots.length > 0 ? Object.fromEntries(slots.map((s) => [s.slot, num(s.kcal_share)])) : DEFAULT_SLOT_SHARES;
  return { profileId, goalType, restrictions, preferences, goal: (goal as GoalRow | null) ?? null, slots, shares };
}

/** Meta diaria de una fecha (respeta metas distintas por día de la semana). */
export function dailyTargetFor(g: GoalRow, date: string): MacroTarget {
  const dayRow = g.by_weekday?.[weekdayIndex(date)];
  return dayRow
    ? { kcal: num(dayRow.kcal), protein_g: num(dayRow.protein_g), carbs_g: num(dayRow.carbs_g), fat_g: num(dayRow.fat_g), fiber_g: num(dayRow.fiber_g) }
    : { kcal: num(g.kcal), protein_g: num(g.protein_g), carbs_g: num(g.carbs_g), fat_g: num(g.fat_g), fiber_g: num(g.fiber_g ?? 0) };
}

/**
 * Objetivo de un tiempo de comida en una fecha. Pauta por porciones si el
 * tiempo la tiene; si no, el reparto de la meta del día con redistribución
 * de lo ya aprobado ese día. null si el perfil no come en ese tiempo.
 */
export function slotTargetFor(d: ProfileGoalData, date: string, slot: Slot, approvedToday: { slot: MealSlot; planned: MacroTarget }[]): PortionTarget | null {
  if (!d.goal) return null;
  const slotRow = d.slots.find((s) => s.slot === slot);
  if (d.goal.mode === "exchanges" && slotRow?.exchange_portions && Object.keys(slotRow.exchange_portions).length > 0) {
    return { mode: "exchanges", portions: slotRow.exchange_portions };
  }
  const daily = dailyTargetFor(d.goal, date);
  let budget: MacroTarget;
  if (slot in d.shares && (d.shares[slot as MealSlot] ?? 0) > 0) {
    budget = slotBudget(daily, d.shares, slot as MealSlot, approvedToday).budget;
  } else if (slot === "extra") {
    // Comida adicional: una fracción fija, sin redistribución.
    budget = { kcal: daily.kcal * EXTRA_SHARE, protein_g: daily.protein_g * EXTRA_SHARE, carbs_g: daily.carbs_g * EXTRA_SHARE, fat_g: daily.fat_g * EXTRA_SHARE, fiber_g: daily.fiber_g * EXTRA_SHARE };
  } else {
    return null;
  }
  return { mode: "macros", budget: { kcal: budget.kcal, protein_g: budget.protein_g, carbs_g: budget.carbs_g, fat_g: budget.fat_g } };
}

export async function participantInputs(
  admin: SupabaseClient,
  profileId: string,
  date: string,
  slot: Slot,
  excludeEventId: string | null,
): Promise<ParticipantInputs> {
  const d = await loadProfileGoalData(admin, profileId);
  const base: Omit<ParticipantInputs, "daily" | "target" | "problem" | "goalSource"> = {
    profileId,
    goalType: d.goalType,
    restrictions: d.restrictions,
    preferences: d.preferences,
  };
  if (!d.goal) {
    return { ...base, daily: null, target: null, problem: "Sin meta vigente: configúrala en Configuración → Metas.", goalSource: null };
  }
  const daily = dailyTargetFor(d.goal, date);

  // Comidas ya aprobadas ese día en otros tiempos (para redistribuir lo que falta o sobra)
  const { data: approved } = await admin
    .from("meal_participants")
    .select("slot, event_id, meal_portions(kcal, protein_g, carbs_g, fat_g, fiber_g), meal_events!inner(plan_status)")
    .eq("profile_id", profileId)
    .eq("date", date)
    .eq("active", true)
    .neq("slot", slot);
  const approvedToday: { slot: MealSlot; planned: MacroTarget }[] = [];
  for (const row of (approved ?? []) as unknown as {
    slot: MealSlot;
    event_id: string;
    meal_portions: { kcal: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown; fiber_g: unknown } | { kcal: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown; fiber_g: unknown }[] | null;
    meal_events: { plan_status: string } | { plan_status: string }[];
  }[]) {
    if (row.event_id === excludeEventId) continue;
    const ev = Array.isArray(row.meal_events) ? row.meal_events[0] : row.meal_events;
    const po = Array.isArray(row.meal_portions) ? row.meal_portions[0] : row.meal_portions;
    if (!po || ev?.plan_status !== "approved" || !(row.slot in d.shares)) continue;
    approvedToday.push({
      slot: row.slot,
      planned: { kcal: num(po.kcal), protein_g: num(po.protein_g), carbs_g: num(po.carbs_g), fat_g: num(po.fat_g), fiber_g: num(po.fiber_g) },
    });
  }

  // Un tiempo sin reparto en la meta se trata como comida adicional (como antes)
  const target = slotTargetFor(d, date, slot, approvedToday) ?? slotTargetFor(d, date, "extra", []);
  return { ...base, daily, target, problem: null, goalSource: d.goal.source };
}
