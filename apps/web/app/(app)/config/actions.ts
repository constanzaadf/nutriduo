"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { computeGoals, macrosFromExchanges, addPortions, ENGINE_VERSION, type ComputeGoalsResult, type ExchangePortions } from "@nutriduo/nutrition-engine";
import { requireContext } from "@/lib/session";
import { todayIn } from "@/lib/dates";
import { num, type ProfileRow } from "@/lib/types";

export type FormState = { ok: boolean; message: string } | null;

const SLOTS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"] as const;

const optionalNumber = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).replace(",", "."))), z.number().min(min).max(max).nullable());

const trainingSchema = z.array(
  z.object({
    label: z.string().trim().min(1).max(60),
    met: z.number().min(1).max(20),
    minutes: z.number().min(5).max(600),
    daysOfWeek: z.array(z.number().int().min(0).max(6)),
    resistance: z.boolean().optional(),
  }),
);

export async function saveProfile(_prev: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const schema = z.object({
    display_name: z.string().trim().min(1).max(80),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    equation_constant: z.enum(["male", "female", "average"]).nullable(),
    height_cm: optionalNumber(120, 230),
    weight_kg: optionalNumber(30, 300),
    body_fat_pct: optionalNumber(3, 70),
    target_weight_kg: optionalNumber(30, 300),
    daily_activity: z.enum(["sedentary", "office_walking", "standing", "physical"]).nullable(),
    work_type: z.string().max(120).nullable(),
    goal_type: z.enum(["fat_loss", "recomposition", "muscle_gain", "maintenance", "balanced", "custom"]).nullable(),
    goal_note: z.string().max(400).nullable(),
    clinical_flags: z.array(z.enum(["pregnancy", "lactation", "medical_condition"])),
    cooking_preferences: z.string().max(600).nullable(),
    professional_notes: z.string().max(2000).nullable(),
    training: trainingSchema,
  });
  const str = (k: string) => {
    const v = fd.get(k);
    return v === null || String(v).trim() === "" ? null : String(v);
  };
  let training: unknown = [];
  try {
    training = JSON.parse(String(fd.get("training") ?? "[]"));
  } catch {
    return { ok: false, message: "Los entrenamientos no tienen un formato válido." };
  }
  const parsed = schema.safeParse({
    display_name: fd.get("display_name"),
    birth_date: str("birth_date"),
    equation_constant: str("equation_constant"),
    height_cm: fd.get("height_cm"),
    weight_kg: fd.get("weight_kg"),
    body_fat_pct: fd.get("body_fat_pct"),
    target_weight_kg: fd.get("target_weight_kg"),
    daily_activity: str("daily_activity"),
    work_type: str("work_type"),
    goal_type: str("goal_type"),
    goal_note: str("goal_note"),
    clinical_flags: fd.getAll("clinical_flags").map(String),
    cooking_preferences: str("cooking_preferences"),
    professional_notes: str("professional_notes"),
    training,
  });
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, message: `Revisa "${i?.path.join(".")}": ${i?.message}` };
  }
  const { error } = await ctx.supabase.from("nutrition_profiles").update(parsed.data).eq("id", ctx.me.profile_id);
  if (error) return { ok: false, message: error.message };
  // Cada cambio de peso queda en el historial de mediciones
  if (parsed.data.weight_kg != null) {
    await ctx.supabase.from("profile_measurements").upsert(
      { profile_id: ctx.me.profile_id, measured_on: todayIn(ctx.household.timezone), weight_kg: parsed.data.weight_kg, body_fat_pct: parsed.data.body_fat_pct },
      { onConflict: "profile_id,measured_on" },
    );
  }
  revalidatePath("/config");
  return { ok: true, message: "Perfil guardado." };
}

export type GoalPreviewState =
  | { ok: true; result: Pick<ComputeGoalsResult, "bmr" | "tdee" | "target" | "warnings" | "appliedAdjust" | "confidence" | "bmrMethod" | "dailyPal" | "exerciseKcalPerWeek" | "byWeekday"> }
  | { ok: false; message: string }
  | null;

async function computeForMe(fd: FormData) {
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("nutrition_profiles").select("*").eq("id", ctx.me.profile_id).single();
  const p = data as ProfileRow;
  const missing = [
    !p.birth_date && "fecha de nacimiento",
    !p.equation_constant && "constante de la ecuación",
    !p.height_cm && "estatura",
    !p.weight_kg && "peso",
    !p.daily_activity && "actividad cotidiana",
    !p.goal_type && "objetivo",
  ].filter(Boolean);
  if (missing.length > 0) return { ctx, error: `Completa y guarda tu perfil primero: falta ${missing.join(", ")}.` } as const;
  const adjustRaw = fd.get("kcal_adjust");
  const adjust = adjustRaw === null || adjustRaw === "" ? undefined : Number(adjustRaw) / 100;
  const r = computeGoals({
    asOf: todayIn(ctx.household.timezone),
    profile: {
      birthDate: p.birth_date!,
      equationConstant: p.equation_constant!,
      heightCm: num(p.height_cm),
      weightKg: num(p.weight_kg),
      bodyFatPct: p.body_fat_pct == null ? null : num(p.body_fat_pct),
      dailyActivity: p.daily_activity!,
      dailyPalOverride: p.daily_pal_override == null ? null : num(p.daily_pal_override),
      training: p.training ?? [],
      goal: p.goal_type!,
      targetWeightKg: p.target_weight_kg == null ? null : num(p.target_weight_kg),
      clinicalFlags: (p.clinical_flags ?? []) as ("pregnancy" | "lactation" | "medical_condition")[],
    },
    overrides: {
      ...(adjust !== undefined && Number.isFinite(adjust) ? { kcalAdjust: adjust } : {}),
      bmrMethod: fd.get("bmr_method") === "katch_mcardle" ? "katch_mcardle" : "mifflin_st_jeor",
      dayMode: fd.get("day_mode") === "by_weekday" ? "by_weekday" : "weekly_average",
    },
  });
  return { ctx, result: r } as const;
}

export async function previewGoals(_prev: GoalPreviewState, fd: FormData): Promise<GoalPreviewState> {
  const out = await computeForMe(fd);
  if ("error" in out) return { ok: false, message: out.error! };
  const r = out.result;
  if (!r.ok) return { ok: false, message: r.warnings.map((w) => w.message).join(" ") };
  return { ok: true, result: r };
}

function slotsFromForm(fd: FormData) {
  const shares = SLOTS.map((s) => ({ slot: s, kcal_share: Number(fd.get(`share_${s}`) ?? 0) / 100 }));
  const total = shares.reduce((a, s) => a + s.kcal_share, 0);
  if (Math.abs(total - 1) > 0.001) return { error: `El reparto por comida suma ${Math.round(total * 100)} %: debe sumar 100 %.` } as const;
  return { slots: shares.filter((s) => s.kcal_share > 0) } as const;
}

export async function saveCalculatedGoal(_prev: FormState, fd: FormData): Promise<FormState> {
  const out = await computeForMe(fd);
  if ("error" in out) return { ok: false, message: out.error! };
  const r = out.result;
  if (!r.ok) return { ok: false, message: r.warnings.map((w) => w.message).join(" ") };
  const slots = slotsFromForm(fd);
  if ("error" in slots) return { ok: false, message: slots.error! };
  const ctx = out.ctx;
  const { data: run, error: runErr } = await ctx.supabase
    .from("calculation_runs")
    .insert({ household_id: ctx.household.id, profile_id: ctx.me.profile_id, engine: "goals", engine_version: ENGINE_VERSION, inputs: r.trace.input, outputs: { ...r, trace: undefined }, created_by: ctx.userId })
    .select("id")
    .single();
  if (runErr) return { ok: false, message: runErr.message };
  const { error } = await ctx.supabase.rpc("set_current_goal", {
    p_profile: ctx.me.profile_id,
    p_goal: {
      source: "calculated",
      confidence: r.confidence,
      kcal: r.target.kcal,
      protein_g: r.target.protein_g,
      carbs_g: r.target.carbs_g,
      fat_g: r.target.fat_g,
      fiber_g: r.target.fiber_g,
      by_weekday: r.byWeekday,
      calc_run_id: run.id,
    },
    p_slots: slots.slots,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Meta calculada guardada como vigente." };
}

export async function saveManualGoal(_prev: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const parsed = z
    .object({
      by: z.enum(["professional", "self"]),
      prescribed_by: z.string().trim().max(120).nullable(),
      kcal: z.coerce.number().min(800).max(6000),
      protein_g: z.coerce.number().min(0).max(500),
      carbs_g: z.coerce.number().min(0).max(1000),
      fat_g: z.coerce.number().min(0).max(400),
    })
    .safeParse({
      by: fd.get("by"),
      prescribed_by: fd.get("prescribed_by") ? String(fd.get("prescribed_by")) : null,
      kcal: fd.get("kcal"),
      protein_g: fd.get("protein_g"),
      carbs_g: fd.get("carbs_g"),
      fat_g: fd.get("fat_g"),
    });
  if (!parsed.success) return { ok: false, message: `Revisa "${parsed.error.issues[0]?.path.join(".")}".` };
  const slots = slotsFromForm(fd);
  if ("error" in slots) return { ok: false, message: slots.error! };
  const d = parsed.data;
  const atwater = d.protein_g * 4 + d.carbs_g * 4 + d.fat_g * 9;
  const { error } = await ctx.supabase.rpc("set_current_goal", {
    p_profile: ctx.me.profile_id,
    p_goal: {
      source: d.by === "professional" ? "prescribed" : "manual",
      confidence: d.by === "professional" ? "prescribed" : "calculated",
      kcal: d.kcal,
      protein_g: d.protein_g,
      carbs_g: d.carbs_g,
      fat_g: d.fat_g,
      fiber_g: (d.kcal / 1000) * 14,
      prescribed_by: d.prescribed_by,
    },
    p_slots: slots.slots,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  const gap = Math.abs(atwater - d.kcal) / d.kcal;
  return {
    ok: true,
    message: gap > 0.08 ? `Meta guardada. Ojo: los macros suman ${Math.round(atwater)} kcal, distinto de las ${d.kcal} indicadas.` : "Meta guardada como vigente.",
  };
}

const GROUPS = [
  "cereales", "verduras_general", "verduras_libre", "frutas", "carnes_altas_grasa", "carnes_bajas_grasa", "legumbres",
  "lacteos_altos_grasa", "lacteos_medios_grasa", "lacteos_bajos_grasa", "aceites_grasas", "alimentos_ricos_lipidos", "azucares",
] as const;

/** Pauta por porciones de intercambio, por tiempo de comida (meta prescrita). */
export async function saveExchangeGoal(_prev: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const perSlot: Record<string, ExchangePortions> = {};
  for (const s of SLOTS) {
    const p: ExchangePortions = {};
    for (const g of GROUPS) {
      const raw = fd.get(`ex_${s}_${g}`);
      const v = raw === null || raw === "" ? 0 : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(v) || v < 0 || v > 20) return { ok: false, message: `Valor inválido en ${s} / ${g}.` };
      if (v > 0) p[g] = v;
    }
    if (Object.keys(p).length > 0) perSlot[s] = p;
  }
  if (Object.keys(perSlot).length === 0) return { ok: false, message: "Ingresa al menos una porción." };

  // Tabla de intercambios del hogar si existe; si no, la global (estimada)
  const { data: rows } = await ctx.supabase.from("exchange_groups").select("household_id, code, label, kcal, protein_g, carbs_g, fat_g");
  const table = Object.fromEntries(
    (rows ?? [])
      .sort((a, b) => (a.household_id ? 1 : 0) - (b.household_id ? 1 : 0))
      .map((r) => [r.code, { code: r.code, label: r.label, kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g) }]),
  ) as Parameters<typeof macrosFromExchanges>[1];
  const daily = macrosFromExchanges(addPortions(...Object.values(perSlot)), table);
  const slotKcal = Object.fromEntries(Object.entries(perSlot).map(([s, p]) => [s, macrosFromExchanges(p, table).kcal]));
  const slots = Object.entries(perSlot).map(([slot, p]) => ({ slot, kcal_share: Math.round((slotKcal[slot]! / daily.kcal) * 1000) / 1000, exchange_portions: p }));
  // Ajuste de redondeo para que sume exactamente 1
  const sum = slots.reduce((a, s) => a + s.kcal_share, 0);
  slots[slots.length - 1]!.kcal_share = Math.round((slots[slots.length - 1]!.kcal_share + (1 - sum)) * 1000) / 1000;

  const { error } = await ctx.supabase.rpc("set_current_goal", {
    p_profile: ctx.me.profile_id,
    p_goal: {
      mode: "exchanges",
      source: "prescribed",
      confidence: "prescribed",
      kcal: daily.kcal,
      protein_g: daily.protein_g,
      carbs_g: daily.carbs_g,
      fat_g: daily.fat_g,
      fiber_g: daily.fiber_g,
      exchange_portions: addPortions(...Object.values(perSlot)),
      prescribed_by: fd.get("prescribed_by") ? String(fd.get("prescribed_by")) : null,
    },
    p_slots: slots,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: `Pauta guardada: ${Math.round(daily.kcal)} kcal diarias según la tabla de intercambios.` };
}

export async function addRestriction(fd: FormData) {
  const ctx = await requireContext();
  const severity = z.enum(["allergy", "prescribed_exclusion", "intolerance", "avoid"]).parse(fd.get("severity"));
  const ingredientId = String(fd.get("ingredient_id") ?? "");
  const tag = String(fd.get("tag") ?? "").trim().toLowerCase();
  if (!ingredientId && !tag) return;
  await ctx.supabase.from("dietary_restrictions").insert({
    profile_id: ctx.me.profile_id,
    severity,
    ingredient_id: ingredientId || null,
    tag: ingredientId ? null : tag,
  });
  revalidatePath("/config");
}

export async function removeRestriction(fd: FormData) {
  const ctx = await requireContext();
  await ctx.supabase.from("dietary_restrictions").delete().eq("id", String(fd.get("id"))).eq("profile_id", ctx.me.profile_id);
  revalidatePath("/config");
}

export async function setVisibility(fd: FormData) {
  const ctx = await requireContext();
  const level = z.enum(["private", "summary", "full"]).parse(fd.get("level"));
  if (!ctx.partner) return;
  await ctx.supabase
    .from("visibility_grants")
    .upsert({ owner_profile_id: ctx.me.profile_id, viewer_profile_id: ctx.partner.profile_id, level }, { onConflict: "owner_profile_id,viewer_profile_id" });
  revalidatePath("/", "layout");
}

export async function regenerateInvite() {
  const ctx = await requireContext();
  await ctx.supabase.rpc("regenerate_invite_code", { p_household: ctx.household.id });
  revalidatePath("/config");
}
