import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditorIngredient } from "@/app/(app)/recetas/recipe-editor";
import { num } from "../types";

export async function loadEditorIngredients(db: SupabaseClient): Promise<EditorIngredient[]> {
  const { data } = await db.from("ingredients").select("id, name, default_state, unit_weight_g, ingredient_nutrition(state, kcal, protein_g, carbs_g, fat_g)").order("name");
  return ((data ?? []) as unknown as {
    id: string;
    name: string;
    default_state: EditorIngredient["default_state"];
    unit_weight_g: number | null;
    ingredient_nutrition: { state: EditorIngredient["default_state"]; kcal: number; protein_g: number; carbs_g: number; fat_g: number }[];
  }[]).map((r) => ({
    id: r.id,
    name: r.name,
    default_state: r.default_state,
    unit_weight_g: r.unit_weight_g == null ? null : num(r.unit_weight_g),
    states: r.ingredient_nutrition.map((n) => n.state),
    per100: Object.fromEntries(r.ingredient_nutrition.map((n) => [n.state, { kcal: num(n.kcal), protein_g: num(n.protein_g), carbs_g: num(n.carbs_g), fat_g: num(n.fat_g) }])),
  }));
}

export const CATEGORY_SLOT: Record<string, "breakfast" | "lunch" | "dinner" | "snack_pm"> = {
  desayunos: "breakfast",
  almuerzos: "lunch",
  cenas: "dinner",
  snacks: "snack_pm",
  postres: "snack_pm",
  preparaciones_base: "lunch",
};

export const CATEGORY_LABEL: Record<string, string> = {
  desayunos: "Desayunos",
  almuerzos: "Almuerzos",
  cenas: "Cenas",
  snacks: "Snacks",
  postres: "Postres",
  preparaciones_base: "Preparaciones base",
};
