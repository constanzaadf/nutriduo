import type { Metadata } from "next";
import { requireContext, personTone } from "@/lib/session";
import { todayIn } from "@/lib/dates";
import { CATEGORY_SLOT } from "@/lib/data/editor";
import { num } from "@/lib/types";
import { Empty, LinkButton, PageHeader, Panel } from "@/components/ui";
import { NewMealForm, type RecipeOption } from "./new-meal-form";

export const metadata: Metadata = { title: "Agregar comida" };

export default async function NewMealPage({ searchParams }: { searchParams: Promise<{ fecha?: string; slot?: string; receta?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [{ data: recipes }, { data: ingredients }, { data: batches }] = await Promise.all([
    ctx.supabase.from("recipes").select("id, name, category, current_version_id, recipe_versions!recipes_current_version_fk(id, is_homogeneous, recipe_ingredients(ingredient_id, role, ingredients(name)))").eq("archived", false).order("favorite", { ascending: false }).order("name"),
    ctx.supabase.from("ingredients").select("id, name, default_state, unit_weight_g").order("name"),
    ctx.supabase.from("cooking_batches").select("id, recipe_version_id, status, cooked_total_g, expected_cooked_g, batch_allocations(grams_cooked), recipe_versions(name)").in("status", ["planned", "cooked"]),
  ]);

  const options: RecipeOption[] = ((recipes ?? []) as unknown as {
    id: string;
    name: string;
    category: string;
    current_version_id: string | null;
    recipe_versions: { id: string; is_homogeneous: boolean; recipe_ingredients: { ingredient_id: string; role: string; ingredients: { name: string } | null }[] } | null;
  }[])
    .filter((r) => r.current_version_id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      versionId: r.current_version_id!,
      defaultSlot: CATEGORY_SLOT[r.category] ?? "lunch",
      sides: (r.recipe_versions?.recipe_ingredients ?? []).filter((l) => l.role === "side").map((l) => ({ id: l.ingredient_id, name: l.ingredients?.name ?? "—" })),
    }));

  const batchOptions = ((batches ?? []) as unknown as { id: string; recipe_version_id: string; cooked_total_g: number | null; expected_cooked_g: number | null; batch_allocations: { grams_cooked: number }[]; recipe_versions: { name: string } | null }[]).map((b) => {
    const total = num(b.cooked_total_g ?? b.expected_cooked_g ?? 0);
    const used = b.batch_allocations.reduce((a, x) => a + num(x.grams_cooked), 0);
    return { id: b.id, versionId: b.recipe_version_id, label: `${b.recipe_versions?.name ?? "Lote"}: quedan ${Math.round(total - used)} g`, remaining: total - used };
  });

  if (options.length === 0) {
    return (
      <>
        <PageHeader title="Agregar comida" />
        <Empty title="Primero necesitas una receta" action={<LinkButton href="/recetas/nueva">Crear receta</LinkButton>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Agregar comida" lead="Compartida, individual o compartida con ajustes. Las porciones se calculan para cada uno al guardar." />
      <Panel className="max-w-3xl">
        <NewMealForm
          people={ctx.people.map((p) => ({ id: p.profile_id, name: p.display_name, tone: personTone(ctx.people, p.profile_id), isMe: p.is_me }))}
          recipes={options}
          ingredients={(ingredients ?? []).map((i) => ({ id: i.id as string, name: i.name as string, state: i.default_state as "raw" | "cooked" | "as_sold", unit: i.unit_weight_g == null ? null : num(i.unit_weight_g) }))}
          batches={batchOptions.filter((b) => b.remaining > 0)}
          initial={{ date: sp.fecha ?? todayIn(ctx.household.timezone), slot: sp.slot ?? null, recipeId: sp.receta ?? null }}
        />
      </Panel>
    </>
  );
}
