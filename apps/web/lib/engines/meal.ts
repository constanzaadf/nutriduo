import "server-only";
import type { RecipeIngredientLine } from "@nutriduo/domain";
import {
  PORTION_ENGINE_VERSION,
  fnv1a,
  planSharedMeal,
  splitInstructions,
  type MixInfo,
  type ParticipantSpec,
  type PortionResult,
  type SharedMealPlan,
} from "@nutriduo/portion-engine";
import { createAdminClient } from "../supabase/admin";
import type { ServerClient } from "../supabase/server";
import { loadIngredients, loadRecipeVersion } from "../data/catalog";
import { num, type BatchRow, type MealEventRow, type ParticipantRow } from "../types";
import { participantInputs, type ParticipantInputs } from "./budget";

export interface MealComputation {
  event: MealEventRow;
  plan: SharedMealPlan | null;
  inputs: ParticipantInputs[];
  problems: string[];
  instructions: string[];
  persisted: boolean;
  recipeName: string;
}

/**
 * Calcula (y opcionalmente aprueba) las porciones de una comida del calendario.
 * El motor corre una vez por participante y nunca mezcla presupuestos.
 */
export async function computeMeal(
  user: ServerClient,
  eventId: string,
  opts: { persist: boolean; names?: Record<string, string> },
): Promise<MealComputation> {
  // 1. Autorización: el usuario debe poder ver el evento (RLS = pertenece al hogar).
  const { data: visible, error: visErr } = await user.from("meal_events").select("id").eq("id", eventId).maybeSingle();
  if (visErr || !visible) throw new Error("Comida no encontrada o sin acceso.");

  const admin = createAdminClient();
  const { data: ev } = await admin.from("meal_events").select("*").eq("id", eventId).single();
  const event = ev as MealEventRow;
  const { data: parts } = await admin.from("meal_participants").select("*").eq("event_id", eventId).eq("active", true);
  const participants = (parts ?? []) as ParticipantRow[];
  const problems: string[] = [];

  if (!event.recipe_version_id || event.plan_status === "eaten_out" || event.plan_status === "cancelled") {
    return { event, plan: null, inputs: [], problems: ["Esta comida no tiene receta asignada."], instructions: [], persisted: false, recipeName: "" };
  }

  // 2. Receta e ingredientes (incluidos los extras de cada participante)
  const { version } = await loadRecipeVersion(admin, event.recipe_version_id);
  const extraIds = participants.flatMap((p) => (p.options?.extras ?? []).map((e) => e.ingredient_id));
  const ingredients = await loadIngredients(admin, [...version.lines.map((l) => l.ingredientId), ...extraIds], event.household_id);

  // 3. Lote de origen, si lo hay
  let batch: { mix: MixInfo; availableG: number } | undefined;
  if (event.batch_id) {
    const { data: b } = await admin.from("cooking_batches").select("*").eq("id", event.batch_id).single();
    const row = b as BatchRow;
    const total = num(row.cooked_total_g ?? row.expected_cooked_g);
    const { data: allocs } = await admin.from("batch_allocations").select("grams_cooked, event_id").eq("batch_id", row.id);
    const usedElsewhere = (allocs ?? []).filter((a) => a.event_id !== eventId).reduce((acc, a) => acc + num(a.grams_cooked), 0);
    batch = {
      mix: { rawLines: row.raw_input.map((l) => ({ ingredientId: l.ingredientId, grams: num(l.grams), state: l.state })), cookedTotalG: total, measured: row.measured },
      availableG: Math.max(0, total - usedElsewhere),
    };
  }

  // 4. Presupuestos individuales
  const inputs = await Promise.all(participants.map((p) => participantInputs(admin, p.profile_id, event.date, event.slot, eventId)));
  const specs: ParticipantSpec[] = [];
  for (const [i, p] of participants.entries()) {
    const inp = inputs[i]!;
    if (!inp.target) {
      problems.push(`${opts.names?.[p.profile_id] ?? "Un participante"}: ${inp.problem}`);
      continue;
    }
    const extras: RecipeIngredientLine[] = (p.options?.extras ?? []).map((e) => {
      const line: RecipeIngredientLine = { ingredientId: e.ingredient_id, grams: num(e.grams), state: e.state, role: "side" };
      if (e.integer_unit_g) {
        line.integerUnitG = num(e.integer_unit_g);
      }
      return line;
    });
    specs.push({
      participantId: p.profile_id,
      target: inp.target,
      goal: inp.goalType,
      restrictions: inp.restrictions,
      preferences: inp.preferences,
      extras,
      skipSideIngredientIds: p.options?.skip_sides ?? [],
    });
  }
  if (specs.length === 0) {
    return { event, plan: null, inputs, problems, instructions: [], persisted: false, recipeName: version.name };
  }

  const plan = planSharedMeal({
    recipe: version,
    ingredients,
    participants: specs,
    ...(batch ? { batch } : {}),
    ...(event.cook_servings ? { cook: { kind: "servings" as const, servings: num(event.cook_servings) } } : {}),
  });

  for (const b of plan.blocked) {
    problems.push(`${opts.names?.[b.participantId] ?? "Un participante"} no puede comer esta preparación: ${b.blockedBy.map((x) => x.reason).join(", ")}. Usa la modalidad individual o una variante.`);
  }
  for (const r of plan.portions) {
    if (r.status === "missing_data") problems.push(`Faltan datos nutricionales: ${(r.missing ?? []).map((m) => `${ingredients.get(m.ingredientId)?.name ?? m.ingredientId} (${m.reason})`).join(", ")}.`);
    if (r.status === "infeasible") problems.push(`${opts.names?.[r.participantId] ?? "Un participante"}: no hay una porción razonable posible. ${r.binding.map((x) => x.message).join(" ")}`);
  }
  if (plan.mix?.batchInsufficient) problems.push("El lote no alcanza para estas porciones.");

  const instructions = splitInstructions(plan, opts.names ?? {});
  let persisted = false;
  if (opts.persist && problems.length === 0) {
    const portions = plan.portions.map((r) => portionPayload(r, inputs.find((x) => x.profileId === r.participantId)!));
    const run = {
      engine_version: PORTION_ENGINE_VERSION,
      input_hash: fnv1a(plan.portions.map((r) => r.trace.inputHash).join("|")),
      inputs: {
        recipe_version_id: version.id,
        batch_id: event.batch_id,
        participants: specs.map((s) => ({ profile_id: s.participantId, target: s.target, goal: s.goal, extras: s.extras, skip: s.skipSideIngredientIds })),
      },
      outputs: {
        cook: { lines: plan.cookLines, mix: plan.mix },
        portions: plan.portions.map((r) => ({ participant: r.participantId, status: r.status, hash: r.trace.inputHash })),
      },
    };
    const { error } = await user.rpc("approve_meal_portions", {
      p_event: eventId,
      p_expected_version: event.row_version,
      p_portions: portions,
      p_run: run,
    });
    if (error) {
      problems.push(error.hint === "event_version_conflict" ? "La comida cambió mientras se calculaba. Vuelve a intentarlo." : error.message);
    } else {
      persisted = true;
    }
  }
  return { event, plan, inputs, problems, instructions, persisted, recipeName: version.name };
}

function portionPayload(r: PortionResult, inp: ParticipantInputs) {
  const total = r.items.reduce((a, i) => a + i.grams, 0);
  return {
    profile_id: r.participantId,
    status: r.status === "within_tolerance" || r.status === "with_deviation" || r.status === "outside_prescribed_tolerance" ? r.status : "with_deviation",
    confidence: r.confidence,
    total_g: round1(total),
    plate_g: round1(r.plateWeightG),
    kcal: round1(r.nutrients.kcal),
    protein_g: round1(r.nutrients.protein_g),
    carbs_g: round1(r.nutrients.carbs_g),
    fat_g: round1(r.nutrients.fat_g),
    fiber_g: round1(r.nutrients.fiber_g),
    sodium_mg: r.nutrients.sodium_mg === null ? null : round1(r.nutrients.sodium_mg),
    budget: inp.target?.mode === "macros" ? inp.target.budget : inp.target?.mode === "exchanges" ? { exchanges: inp.target.portions } : null,
    deviations: r.deviations,
    explanations: [...r.binding.map((b) => b.message), ...r.warnings.map((w) => w.message)],
    items: r.items.map((i) => ({ ingredient_id: i.ingredientId, kind: i.kind, label: i.label, grams: i.grams, state: i.state, units: i.units ?? null })),
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
