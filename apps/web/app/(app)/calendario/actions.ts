"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/session";
import { computeMeal } from "@/lib/engines/meal";
import { isoWeekOf } from "@/lib/dates";
import { num, type ParticipantOptions } from "@/lib/types";

export type MealFormState = { ok: boolean; message: string } | null;

const SLOT = z.enum(["breakfast", "snack_am", "lunch", "snack_pm", "dinner", "extra"]);

function names(people: { profile_id: string; display_name: string }[]) {
  return Object.fromEntries(people.map((p) => [p.profile_id, p.display_name]));
}

/** Crea la comida (1 evento, N participantes), calcula porciones y las aprueba. */
export async function createMeal(_prev: MealFormState, fd: FormData): Promise<MealFormState> {
  const ctx = await requireContext();
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slot: SLOT,
      mode: z.enum(["A", "B", "C"]),
      recipe_id: z.string().uuid("Elige una receta"),
      participants: z.array(z.string().uuid()).min(1, "Elige quién come"),
      batch_id: z.string().uuid().nullable(),
      cook_servings: z.number().positive().max(50).nullable(),
      options: z.record(
        z.string(),
        z.object({
          extras: z.array(z.object({ ingredient_id: z.string().uuid(), grams: z.number().positive().max(2000), state: z.enum(["raw", "cooked", "as_sold"]), integer_unit_g: z.number().positive().nullable().optional() })).default([]),
          skip_sides: z.array(z.string().uuid()).default([]),
        }),
      ),
    })
    .safeParse({
      date: fd.get("date"),
      slot: fd.get("slot"),
      mode: fd.get("mode"),
      recipe_id: fd.get("recipe_id"),
      participants: fd.getAll("participants").map(String),
      batch_id: fd.get("batch_id") ? String(fd.get("batch_id")) : null,
      cook_servings: fd.get("cook_servings") ? Number(fd.get("cook_servings")) : null,
      options: JSON.parse(String(fd.get("options") ?? "{}")),
    });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos" };
  const d = parsed.data;
  if (d.mode === "B" && d.participants.length !== 1) return { ok: false, message: "Una comida individual es para una sola persona." };
  if (d.mode !== "B" && d.participants.length < 2 && ctx.people.length > 1) {
    return { ok: false, message: "Una comida compartida es para ambos. Para una sola persona, usa la modalidad individual." };
  }
  for (const p of d.participants) if (!ctx.people.some((x) => x.profile_id === p)) return { ok: false, message: "Participante inválido." };

  const { data: recipe } = await ctx.supabase.from("recipes").select("current_version_id").eq("id", d.recipe_id).single();
  if (!recipe?.current_version_id) return { ok: false, message: "La receta no tiene una versión vigente." };

  const { data: eventId, error } = await ctx.supabase.rpc("create_meal_event", {
    p_household: ctx.household.id,
    p_date: d.date,
    p_slot: d.slot,
    p_mode: d.mode,
    p_version: recipe.current_version_id,
    p_profiles: d.participants,
    p_batch: d.batch_id,
    p_cook_servings: d.cook_servings,
  });
  if (error) {
    if (error.hint === "allergen_blocked") return { ok: false, message: `${error.message}. Puedes usar la modalidad individual para esa persona.` };
    if (error.code === "23505") return { ok: false, message: "Alguien ya tiene una comida planificada en ese tiempo de ese día. Muévela o elimínala primero." };
    return { ok: false, message: error.message };
  }
  // Ajustes individuales (modalidad C)
  if (d.mode === "C") {
    for (const [profileId, opts] of Object.entries(d.options) as [string, Required<ParticipantOptions>][]) {
      const options: ParticipantOptions = { extras: opts.extras, skip_sides: opts.skip_sides };
      await ctx.supabase.from("meal_participants").update({ options }).eq("event_id", eventId).eq("profile_id", profileId);
    }
  }
  await computeMeal(ctx.supabase, eventId as string, { persist: true, names: names(ctx.people) });
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
  redirect(`/calendario/evento/${eventId}`);
}

export async function recalcMeal(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("event_id"));
  await computeMeal(ctx.supabase, id, { persist: true, names: names(ctx.people) });
  revalidatePath(`/calendario/evento/${id}`);
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}

export async function deleteMeal(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("event_id"));
  const { data: ev } = await ctx.supabase.from("meal_events").select("date").eq("id", id).single();
  await ctx.supabase.from("meal_events").delete().eq("id", id);
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
  redirect(`/calendario${ev ? `?semana=${isoWeekOf(ev.date as string)}` : ""}`);
}

export async function moveMeal(_prev: MealFormState, fd: FormData): Promise<MealFormState> {
  const ctx = await requireContext();
  const id = String(fd.get("event_id"));
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: SLOT }).safeParse({ date: fd.get("date"), slot: fd.get("slot") });
  if (!parsed.success) return { ok: false, message: "Fecha o tiempo de comida inválidos." };
  const { data: planId } = await ctx.supabase.rpc("ensure_meal_plan", { p_household: ctx.household.id, p_date: parsed.data.date });
  const { error } = await ctx.supabase.from("meal_events").update({ date: parsed.data.date, slot: parsed.data.slot, plan_id: planId }).eq("id", id);
  if (error) return { ok: false, message: error.code === "23505" ? "Ese tiempo ya tiene una comida para alguno de los participantes." : error.message };
  // El presupuesto depende del día: se recalcula
  await computeMeal(ctx.supabase, id, { persist: true, names: names(ctx.people) });
  revalidatePath("/calendario");
  revalidatePath(`/calendario/evento/${id}`);
  return { ok: true, message: "Comida movida y recalculada." };
}

export async function markEatenOut(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("event_id"));
  const restore = fd.get("restore") === "1";
  await ctx.supabase.from("meal_events").update({ plan_status: restore ? "draft" : "eaten_out" }).eq("id", id);
  if (restore) await computeMeal(ctx.supabase, id, { persist: true, names: names(ctx.people) });
  revalidatePath(`/calendario/evento/${id}`);
  revalidatePath("/calendario");
}

/** Copia las comidas de un día a otro: se copian recetas y modalidades, no porciones. */
export async function copyDay(fd: FormData) {
  const ctx = await requireContext();
  const from = String(fd.get("from"));
  const to = String(fd.get("to"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from === to) return;
  const { data: events } = await ctx.supabase
    .from("meal_events")
    .select("id, slot, mode, recipe_version_id, meal_participants(profile_id, options, active)")
    .eq("household_id", ctx.household.id)
    .eq("date", from)
    .in("plan_status", ["draft", "approved"]);
  for (const e of (events ?? []) as unknown as { id: string; slot: string; mode: string; recipe_version_id: string; meal_participants: { profile_id: string; options: ParticipantOptions; active: boolean }[] }[]) {
    const parts = e.meal_participants.filter((p) => p.active);
    const { data: newId, error } = await ctx.supabase.rpc("create_meal_event", {
      p_household: ctx.household.id,
      p_date: to,
      p_slot: e.slot,
      p_mode: e.mode,
      p_version: e.recipe_version_id,
      p_profiles: parts.map((p) => p.profile_id),
    });
    if (error) continue; // si el destino ya está ocupado, se salta esa comida
    for (const p of parts) {
      if (p.options && Object.keys(p.options).length) await ctx.supabase.from("meal_participants").update({ options: p.options }).eq("event_id", newId).eq("profile_id", p.profile_id);
    }
    await computeMeal(ctx.supabase, newId as string, { persist: true, names: names(ctx.people) });
  }
  revalidatePath("/calendario");
}

export async function logConsumption(_prev: MealFormState, fd: FormData): Promise<MealFormState> {
  const ctx = await requireContext();
  const kind = z.enum(["as_planned", "modified_portion", "different_meal", "eaten_out", "skipped"]).parse(fd.get("kind"));
  const eventId = fd.get("event_id") ? String(fd.get("event_id")) : null;
  const date = String(fd.get("date"));
  const slot = SLOT.parse(fd.get("slot"));
  let values: { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; confidence: string } = {
    kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, confidence: "estimated",
  };
  let factor: number | null = null;
  if ((kind === "as_planned" || kind === "modified_portion") && eventId) {
    const { data: part } = await ctx.supabase.from("meal_participants").select("id, meal_portions(kcal, protein_g, carbs_g, fat_g, fiber_g, confidence)").eq("event_id", eventId).eq("profile_id", ctx.me.profile_id).single();
    const po = (part as unknown as { meal_portions: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; confidence: string } | null } | null)?.meal_portions;
    if (!po) return { ok: false, message: "Esta comida no tiene una porción aprobada para ti." };
    factor = kind === "modified_portion" ? Number(fd.get("factor") ?? 1) : 1;
    if (!Number.isFinite(factor) || factor < 0 || factor > 4) return { ok: false, message: "Proporción inválida." };
    values = {
      kcal: num(po.kcal) * factor,
      protein_g: num(po.protein_g) * factor,
      carbs_g: num(po.carbs_g) * factor,
      fat_g: num(po.fat_g) * factor,
      fiber_g: num(po.fiber_g) * factor,
      confidence: kind === "as_planned" ? po.confidence : "estimated",
    };
  } else if (kind === "different_meal" || kind === "eaten_out") {
    const k = fd.get("kcal") ? Number(fd.get("kcal")) : null;
    values = { ...values, kcal: k != null && Number.isFinite(k) ? k : null };
  } else if (kind === "skipped") {
    values = { ...values, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, confidence: "calculated" };
  }
  const row = {
    profile_id: ctx.me.profile_id,
    date,
    slot,
    event_id: eventId,
    kind,
    portion_factor: kind === "modified_portion" ? factor : null,
    free_text: fd.get("free_text") ? String(fd.get("free_text")) : null,
    ...values,
  };
  // Un solo registro por comida planificada: si ya existe, se reemplaza.
  if (eventId) await ctx.supabase.from("consumption_logs").delete().eq("profile_id", ctx.me.profile_id).eq("event_id", eventId);
  const { error } = await ctx.supabase.from("consumption_logs").insert(row);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/progreso");
  if (eventId) revalidatePath(`/calendario/evento/${eventId}`);
  return { ok: true, message: "Consumo registrado." };
}
