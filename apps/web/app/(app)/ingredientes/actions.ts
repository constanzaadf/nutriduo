"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/session";

export type IngredientState = { ok: boolean; message: string } | null;

const n = (min: number, max: number) => z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).replace(",", "."))), z.number().min(min).max(max).nullable());

export async function createIngredient(_prev: IngredientState, fd: FormData): Promise<IngredientState> {
  const ctx = await requireContext();
  const schema = z.object({
    name: z.string().trim().min(1).max(120),
    category: z.string(),
    state: z.enum(["raw", "cooked", "as_sold"]),
    kcal: n(0, 950),
    protein_g: n(0, 100),
    carbs_g: n(0, 100),
    fat_g: n(0, 100),
    fiber_g: n(0, 100),
    sodium_mg: n(0, 50000),
    source: z.enum(["label", "fdc", "manual"]),
    source_ref: z.string().max(200).nullable(),
    unit_weight_g: n(0.1, 5000),
    yield_factor: n(0.1, 5),
    exchange_group_code: z.string().nullable(),
    exchange_grams: n(0.1, 2000),
    allergen_tags: z.string().max(200),
    pack_grams: n(1, 100000),
    pack_price: n(0, 10000000),
  });
  const get = (k: string) => {
    const v = fd.get(k);
    return v === null || String(v).trim() === "" ? null : String(v);
  };
  const parsed = schema.safeParse({
    name: fd.get("name"),
    category: fd.get("category"),
    state: fd.get("state"),
    kcal: fd.get("kcal"),
    protein_g: fd.get("protein_g"),
    carbs_g: fd.get("carbs_g"),
    fat_g: fd.get("fat_g"),
    fiber_g: fd.get("fiber_g"),
    sodium_mg: fd.get("sodium_mg"),
    source: fd.get("source"),
    source_ref: get("source_ref"),
    unit_weight_g: fd.get("unit_weight_g"),
    yield_factor: fd.get("yield_factor"),
    exchange_group_code: get("exchange_group_code"),
    exchange_grams: fd.get("exchange_grams"),
    allergen_tags: String(fd.get("allergen_tags") ?? ""),
    pack_grams: fd.get("pack_grams"),
    pack_price: fd.get("pack_price"),
  });
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, message: `Revisa "${i?.path.join(".")}": ${i?.message}` };
  }
  const d = parsed.data;
  if (d.kcal == null || d.protein_g == null || d.carbs_g == null || d.fat_g == null) {
    return { ok: false, message: "Energía, proteínas, carbohidratos y grasas por 100 g son obligatorios: sin ellos el motor no puede calcular." };
  }
  if (d.protein_g + d.carbs_g + d.fat_g > 100.5) return { ok: false, message: "Proteínas + carbohidratos + grasas no pueden superar 100 g por cada 100 g." };
  const atwater = d.protein_g * 4 + d.carbs_g * 4 + d.fat_g * 9;
  if ((d.exchange_group_code == null) !== (d.exchange_grams == null)) return { ok: false, message: "Para el intercambio indica el grupo y los gramos de una porción, o ninguno." };

  const { data: ing, error } = await ctx.supabase
    .from("ingredients")
    .insert({
      household_id: ctx.household.id,
      name: d.name,
      category: d.category,
      default_state: d.state,
      unit_weight_g: d.unit_weight_g,
      exchange_group_code: d.exchange_group_code,
      exchange_grams: d.exchange_grams,
      exchange_state: d.exchange_group_code ? d.state : null,
      allergen_tags: d.allergen_tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !ing) return { ok: false, message: error?.code === "23505" ? "Ya existe un ingrediente con ese nombre." : (error?.message ?? "Error") };

  const results = await Promise.all([
    ctx.supabase.from("ingredient_nutrition").insert({
      ingredient_id: ing.id,
      state: d.state,
      kcal: d.kcal,
      protein_g: d.protein_g,
      carbs_g: d.carbs_g,
      fat_g: d.fat_g,
      fiber_g: d.fiber_g ?? 0,
      sodium_mg: d.sodium_mg,
      source: d.source,
      source_ref: d.source_ref,
      confidence: d.source === "manual" ? "estimated" : "calculated",
    }),
    d.yield_factor ? ctx.supabase.from("ingredient_yields").insert({ ingredient_id: ing.id, method: "default", yield_factor: d.yield_factor }) : Promise.resolve({ error: null }),
    d.pack_grams
      ? ctx.supabase.from("pack_sizes").insert({ household_id: ctx.household.id, ingredient_id: ing.id, grams: d.pack_grams, label: `${d.pack_grams} g`, price: d.pack_price })
      : Promise.resolve({ error: null }),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    await ctx.supabase.from("ingredients").delete().eq("id", ing.id);
    return { ok: false, message: failed.error.message };
  }
  revalidatePath("/ingredientes");
  const warn = Math.abs(atwater - d.kcal) > Math.max(25, d.kcal * 0.12) ? ` Ojo: los macros suman ≈ ${Math.round(atwater)} kcal por 100 g; revisa la etiqueta.` : "";
  return { ok: true, message: `${d.name} agregado.${warn}` };
}

export async function deleteIngredient(fd: FormData) {
  const ctx = await requireContext();
  await ctx.supabase.from("ingredients").delete().eq("id", String(fd.get("id"))).eq("household_id", ctx.household.id);
  revalidatePath("/ingredientes");
}

/** Ajusta (o quita) la porción de intercambio de un ingrediente para este hogar. */
export async function setExchangeOverride(fd: FormData) {
  const ctx = await requireContext();
  const schema = z.object({
    ingredient_id: z.string().uuid(),
    mode: z.enum(["set", "none", "reset"]),
    exchange_group_code: z.string().max(60).nullable(),
    exchange_grams: n(0.1, 2000),
    note: z.string().trim().max(200).nullable(),
  });
  const get = (k: string) => {
    const v = fd.get(k);
    return v === null || String(v).trim() === "" ? null : String(v);
  };
  const d = schema.safeParse({
    ingredient_id: fd.get("ingredient_id"),
    mode: fd.get("mode"),
    exchange_group_code: get("exchange_group_code"),
    exchange_grams: fd.get("exchange_grams"),
    note: get("note"),
  });
  if (!d.success) throw new Error("Datos inválidos para el ajuste de intercambio.");
  const { ingredient_id, mode, exchange_group_code, exchange_grams, note } = d.data;
  if (mode === "reset") {
    await ctx.supabase.from("household_ingredient_overrides").delete().eq("household_id", ctx.household.id).eq("ingredient_id", ingredient_id);
  } else {
    if (mode === "set" && (!exchange_group_code || exchange_grams == null)) throw new Error("Indica el grupo y los gramos de una porción.");
    const { error } = await ctx.supabase.from("household_ingredient_overrides").upsert({
      household_id: ctx.household.id,
      ingredient_id,
      exchange_group_code: mode === "set" ? exchange_group_code : null,
      exchange_grams: mode === "set" ? exchange_grams : null,
      note,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/ingredientes");
}
