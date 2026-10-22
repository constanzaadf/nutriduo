"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/session";

export type RecipeState = { ok: boolean; message: string } | null;

const lineSchema = z.object({
  ingredient_id: z.string().uuid("Elige un ingrediente en cada línea"),
  grams: z.number().positive("Los gramos deben ser mayores que 0").max(10000),
  state: z.enum(["raw", "cooked", "as_sold"]),
  role: z.enum(["fixed", "adjustable", "ratio", "side"]),
  min_g: z.number().positive().nullable().optional(),
  max_g: z.number().positive().nullable().optional(),
  ratio_group: z.string().trim().max(40).nullable().optional(),
  integer_unit_g: z.number().positive().nullable().optional(),
});

const payloadSchema = z.object({
  recipeId: z.string().uuid().nullable(),
  parentVersionId: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Falta el nombre").max(120),
  category: z.enum(["desayunos", "almuerzos", "cenas", "snacks", "postres", "preparaciones_base"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  prep_minutes: z.number().int().min(0).max(1440).nullable(),
  servings_nominal: z.number().positive("Las porciones deben ser mayores que 0").max(100),
  is_homogeneous: z.boolean(),
  expected_cooked_yield_g: z.number().positive().nullable(),
  instructions: z.string().max(8000).nullable(),
  change: z.string().max(300).nullable(),
  why: z.string().max(600).nullable(),
  lines: z.array(lineSchema).min(1, "Agrega al menos un ingrediente"),
});

export async function saveRecipe(_prev: RecipeState, fd: FormData): Promise<RecipeState> {
  const ctx = await requireContext();
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return { ok: false, message: "No se pudo leer el formulario." };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa la receta" };
  const p = parsed.data;
  for (const l of p.lines) {
    if (l.role === "ratio" && !l.ratio_group) return { ok: false, message: "Las líneas en proporción necesitan un nombre de grupo (por ejemplo, “salsa”)." };
    if (l.min_g && l.max_g && l.min_g > l.max_g) return { ok: false, message: "En una línea el mínimo supera al máximo." };
  }
  const version = {
    name: p.name,
    servings_nominal: p.servings_nominal,
    is_homogeneous: p.is_homogeneous,
    expected_cooked_yield_g: p.expected_cooked_yield_g,
    instructions: p.instructions,
    change_log: p.change ? [{ change: p.change, why: p.why ?? "" }] : [],
  };
  const lines = p.lines.map((l) => ({ ...l, ratio_group: l.role === "ratio" ? l.ratio_group : null }));

  let recipeId = p.recipeId;
  if (!recipeId) {
    const { data, error } = await ctx.supabase.rpc("create_recipe", {
      p_household: ctx.household.id,
      p_recipe: { name: p.name, category: p.category, tags: p.tags, prep_minutes: p.prep_minutes },
      p_version: version,
      p_lines: lines,
    });
    if (error) return { ok: false, message: error.message };
    recipeId = data as string;
  } else {
    // Nunca se sobrescribe: cada edición es una versión nueva con su padre.
    const { error } = await ctx.supabase.rpc("create_recipe_version", {
      p_recipe: recipeId,
      p_version: version,
      p_lines: lines,
      p_parent: p.parentVersionId,
      p_origin: "manual",
      p_make_current: true,
    });
    if (error) return { ok: false, message: error.message };
    await ctx.supabase.from("recipes").update({ name: p.name, category: p.category, tags: p.tags, prep_minutes: p.prep_minutes }).eq("id", recipeId);
  }
  revalidatePath("/recetas");
  redirect(`/recetas/${recipeId}`);
}

export async function toggleFavorite(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("id"));
  const fav = fd.get("favorite") === "true";
  await ctx.supabase.from("recipes").update({ favorite: !fav }).eq("id", id);
  revalidatePath("/recetas");
  revalidatePath(`/recetas/${id}`);
}

export async function setCurrentVersion(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("recipe_id"));
  await ctx.supabase.from("recipes").update({ current_version_id: String(fd.get("version_id")) }).eq("id", id);
  revalidatePath(`/recetas/${id}`);
}

export async function archiveRecipe(fd: FormData) {
  const ctx = await requireContext();
  await ctx.supabase.from("recipes").update({ archived: true }).eq("id", String(fd.get("id")));
  revalidatePath("/recetas");
  redirect("/recetas");
}
