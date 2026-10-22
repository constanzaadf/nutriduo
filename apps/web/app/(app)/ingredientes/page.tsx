import type { Metadata } from "next";
import { requireContext } from "@/lib/session";
import { num } from "@/lib/types";
import { Empty, PageHeader, Panel, SectionTitle, Tag } from "@/components/ui";
import { IngredientForm } from "./ingredient-form";
import { deleteIngredient } from "./actions";

export const metadata: Metadata = { title: "Ingredientes" };

const STATE: Record<string, string> = { raw: "crudo", cooked: "cocido", as_sold: "como se vende" };
const SOURCE: Record<string, string> = { label: "Etiqueta", fdc: "USDA FDC", manual: "Manual (estimado)", exchange_table: "Tabla" };

export default async function IngredientsPage() {
  const ctx = await requireContext();
  const { data } = await ctx.supabase
    .from("ingredients")
    .select("id, household_id, name, category, allergen_tags, unit_weight_g, ingredient_nutrition(state, kcal, protein_g, carbs_g, fat_g, source), ingredient_yields(yield_factor)")
    .order("name");
  const rows = (data ?? []) as unknown as {
    id: string;
    household_id: string | null;
    name: string;
    category: string;
    allergen_tags: string[];
    unit_weight_g: number | null;
    ingredient_nutrition: { state: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; source: string }[];
    ingredient_yields: { yield_factor: number }[];
  }[];

  return (
    <>
      <PageHeader title="Ingredientes" lead="La base de todo cálculo. Carga los valores por 100 g desde la etiqueta nutricional del envase." />
      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <Panel className="p-0 sm:p-0">
          {rows.length === 0 ? (
            <div className="p-5"><Empty title="Aún no hay ingredientes">Agrega los que más usan; cada uno sirve para todas las recetas del hogar.</Empty></div>
          ) : (
            <ul className="divide-y divide-avena">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="cifra text-sm text-tinta-suave">
                      {r.ingredient_nutrition.map((nrow) => `${Math.round(num(nrow.kcal))} kcal, P ${num(nrow.protein_g)}, C ${num(nrow.carbs_g)}, G ${num(nrow.fat_g)} por 100 g ${STATE[nrow.state]}`).join(" / ") || "Sin datos nutricionales"}
                      {r.ingredient_yields[0] ? `, rinde ×${String(num(r.ingredient_yields[0].yield_factor)).replace(".", ",")} al cocinar` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.ingredient_nutrition[0] ? <Tag>{SOURCE[r.ingredient_nutrition[0].source]}</Tag> : null}
                    {r.allergen_tags.map((t) => <Tag key={t} tone="warn">{t}</Tag>)}
                    {r.household_id ? (
                      <form action={deleteIngredient}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-sm text-tinta-suave hover:text-ladrillo" aria-label={`Eliminar ${r.name}`}>Eliminar</button>
                      </form>
                    ) : (
                      <Tag>Catálogo</Tag>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="h-fit">
          <SectionTitle>Agregar ingrediente</SectionTitle>
          <IngredientForm />
        </Panel>
      </div>
    </>
  );
}
