import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/session";
import { loadEditorIngredients } from "@/lib/data/editor";
import { num, type RecipeLineRow, type RecipeRow, type RecipeVersionRow } from "@/lib/types";
import { PageHeader, Panel } from "@/components/ui";
import { RecipeEditor } from "../../recipe-editor";

export const metadata: Metadata = { title: "Versión nueva" };

export default async function EditRecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ desde?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const { data: rec } = await ctx.supabase.from("recipes").select("*").eq("id", id).maybeSingle();
  if (!rec) notFound();
  const recipe = rec as RecipeRow;
  const fromId = sp.desde ?? recipe.current_version_id;
  if (!fromId) notFound();
  const [{ data: v }, { data: ls }, ingredients] = await Promise.all([
    ctx.supabase.from("recipe_versions").select("*").eq("id", fromId).single(),
    ctx.supabase.from("recipe_ingredients").select("*").eq("version_id", fromId).order("position"),
    loadEditorIngredients(ctx.supabase),
  ]);
  if (!v) notFound();
  const from = v as RecipeVersionRow;
  const lines = (ls ?? []) as RecipeLineRow[];

  return (
    <>
      <PageHeader title={`Versión nueva de ${recipe.name}`} lead={`Parte de la versión ${from.version_no}. Esa versión no se modifica.`} />
      <Panel>
        <RecipeEditor
          isNewVersion
          ingredients={ingredients}
          initial={{
            recipeId: recipe.id,
            parentVersionId: from.id,
            name: from.name,
            category: recipe.category,
            tags: recipe.tags,
            prep_minutes: recipe.prep_minutes,
            servings_nominal: num(from.servings_nominal),
            is_homogeneous: from.is_homogeneous,
            expected_cooked_yield_g: from.expected_cooked_yield_g == null ? null : num(from.expected_cooked_yield_g),
            instructions: from.instructions ?? "",
            lines: lines.map((l) => ({
              ingredient_id: l.ingredient_id,
              grams: num(l.grams),
              state: l.state,
              role: l.role,
              min_g: l.min_g == null ? null : num(l.min_g),
              max_g: l.max_g == null ? null : num(l.max_g),
              ratio_group: l.ratio_group,
              integer_unit_g: l.integer_unit_g == null ? null : num(l.integer_unit_g),
            })),
          }}
        />
      </Panel>
    </>
  );
}
