import "server-only";
import type { MealSlot } from "@nutriduo/nutrition-engine";
import { defaultWeekSlots, planWeek, type MenuParticipant, type MenuProposal, type MenuRecipe, type PlanSlot } from "@nutriduo/menu-engine";
import type { Ingredient } from "@nutriduo/domain";
import { createAdminClient } from "../supabase/admin";
import type { AppContext } from "../session";
import { loadIngredients, loadRecipeVersions } from "../data/catalog";
import { addDays, mondayOf, shiftWeek, weekDays } from "../dates";
import { num, type RecipeRow } from "../types";
import { loadProfileGoalData, slotTargetFor } from "./budget";

export interface WeekMenuOptions {
  week: string;
  seed: number;
  pots: number;
  weekdayDinner: "batch" | "fresh";
  breakfast: boolean;
}

export function parseWeekMenuOptions(sp: Record<string, string | undefined>, fallbackWeek: string): WeekMenuOptions {
  const week = sp.semana && /^\d{4}-W\d{2}$/.test(sp.semana) ? sp.semana : fallbackWeek;
  const seed = Number.isInteger(Number(sp.variante)) ? Math.max(0, Math.min(999, Number(sp.variante))) : 0;
  const pots = [1, 2, 3, 4].includes(Number(sp.ollas)) ? Number(sp.ollas) : 3;
  return { week, seed, pots, weekdayDinner: sp.cenas === "dia" ? "fresh" : "batch", breakfast: sp.desayuno !== "no" };
}

export interface WeekMenuResult {
  proposal: MenuProposal;
  cookDate: string;
  ingredients: Map<string, Ingredient>;
  recipes: Map<string, MenuRecipe>;
  skippedOccupied: { date: string; slot: MealSlot }[];
  peopleWithoutGoal: string[];
  participants: string[];
}

/**
 * Propuesta de menú para una semana. Los presupuestos de ambas personas se
 * leen en el servidor con el cliente admin (como al calcular una comida
 * compartida), después de que requireContext verificó la membresía.
 */
export async function proposeWeekMenu(ctx: AppContext, o: WeekMenuOptions): Promise<WeekMenuResult> {
  const admin = createAdminClient();
  const monday = mondayOf(o.week);
  const days = weekDays(o.week);
  const cookDate = addDays(monday, -1);

  // Personas: solo quienes tienen meta vigente
  const goals = await Promise.all(ctx.people.map((p) => loadProfileGoalData(admin, p.profile_id)));
  const peopleWithoutGoal = ctx.people.filter((_, i) => !goals[i]!.goal).map((p) => p.display_name);

  // Tiempos ya ocupados por alguien del hogar: no se tocan
  const { data: occ } = await ctx.supabase
    .from("meal_events")
    .select("date, slot")
    .eq("household_id", ctx.household.id)
    .gte("date", days[0]!)
    .lte("date", days[6]!)
    .neq("plan_status", "cancelled");
  const occupied = new Set((occ ?? []).map((e) => `${e.date}|${e.slot}`));
  const all = defaultWeekSlots(monday, { breakfast: o.breakfast, weekdayDinner: o.weekdayDinner });
  const slots: PlanSlot[] = all.filter((s) => !occupied.has(`${s.date}|${s.slot}`));
  const skippedOccupied = all.filter((s) => occupied.has(`${s.date}|${s.slot}`)).map((s) => ({ date: s.date, slot: s.slot }));

  const participants: MenuParticipant[] = [];
  for (const g of goals) {
    if (!g.goal) continue;
    const targets: MenuParticipant["targets"] = {};
    const targetsByDate: NonNullable<MenuParticipant["targetsByDate"]> = {};
    for (const slot of ["breakfast", "lunch", "dinner"] as MealSlot[]) {
      const t = slotTargetFor(g, monday, slot, []);
      if (t) targets[slot] = t;
      for (const d of days) {
        const td = slotTargetFor(g, d, slot, []);
        if (td) (targetsByDate[d] ??= {})[slot] = td;
      }
    }
    participants.push({ id: g.profileId, targets, targetsByDate, goal: g.goalType, restrictions: g.restrictions, preferences: g.preferences });
  }

  // Recetas del hogar con su versión vigente
  const { data: rs } = await ctx.supabase.from("recipes").select("*").eq("household_id", ctx.household.id).eq("archived", false);
  const rows = ((rs ?? []) as RecipeRow[]).filter((r) => r.current_version_id);
  const versions = await loadRecipeVersions(ctx.supabase, rows.map((r) => r.current_version_id!));
  const ingredients = await loadIngredients(ctx.supabase, [...versions.values()].flatMap((v) => v.lines.map((l) => l.ingredientId)), ctx.household.id);
  const recipes = new Map<string, MenuRecipe>();
  for (const r of rows) {
    const v = versions.get(r.current_version_id!);
    if (v) recipes.set(r.id, { recipeId: r.id, version: v, category: r.category, prepMinutes: r.prep_minutes, favorite: r.favorite });
  }

  // Lo comido las dos semanas anteriores pesa un poco en contra (variedad entre semanas)
  const { data: recentEv } = await ctx.supabase
    .from("meal_events")
    .select("recipe_versions(recipe_id)")
    .eq("household_id", ctx.household.id)
    .gte("date", mondayOf(shiftWeek(o.week, -2)))
    .lt("date", monday);
  const recentRecipeIds = [
    ...new Set(
      ((recentEv ?? []) as unknown as { recipe_versions: { recipe_id: string } | { recipe_id: string }[] | null }[])
        .map((e) => (Array.isArray(e.recipe_versions) ? e.recipe_versions[0] : e.recipe_versions)?.recipe_id)
        .filter((x): x is string => !!x),
    ),
  ];

  const { data: inv } = await ctx.supabase.from("inventory_items").select("ingredient_id, grams, expires_on").eq("household_id", ctx.household.id);
  const pantry = (inv ?? []).map((i) => ({ ingredientId: i.ingredient_id as string, grams: num(i.grams), expiresOn: (i.expires_on as string | null) ?? null }));

  const proposal =
    participants.length === 0 || slots.length === 0
      ? { events: [], batches: [], days: [], unfilled: [], notes: [], trace: { engineVersion: "", inputHash: "", seed: o.seed, evaluations: 0 } }
      : planWeek({ cookDate, slots, participants, recipes: [...recipes.values()], ingredients, recentRecipeIds, pantry, options: { batchCount: o.pots, seed: o.seed } });

  return { proposal, cookDate, ingredients, recipes, skippedOccupied, peopleWithoutGoal, participants: participants.map((p) => p.id) };
}

/** Lotes a crear: uno refrigerado y, si hace falta, otro para congelar, con los crudos repartidos en proporción. */
export function batchRows(p: MenuProposal) {
  const out: { key: string; recipe_version_id: string; planned_for: string; raw_input: { ingredientId: string; grams: number; state: string }[]; expected_cooked_g: number; location: "fridge" | "freezer"; frozen: boolean; use_by: string }[] = [];
  for (const b of p.batches) {
    const used = b.fridgeG + b.freezerG;
    for (const where of ["fridge", "freezer"] as const) {
      const g = where === "fridge" ? b.fridgeG : b.freezerG;
      if (g <= 0) continue;
      const share = used > 0 ? g / used : 1;
      out.push({
        key: `${b.key}:${where}`,
        recipe_version_id: b.versionId,
        planned_for: b.cookDate,
        raw_input: b.rawLines.map((l) => ({ ingredientId: l.ingredientId, grams: Math.max(1, Math.round(l.grams * share)), state: l.state })),
        expected_cooked_g: Math.max(1, Math.round(b.cookedTotalG * share)),
        location: where,
        frozen: where === "freezer",
        use_by: where === "fridge" ? b.useByFridge : addDays(b.cookDate, 60),
      });
    }
  }
  return out;
}
