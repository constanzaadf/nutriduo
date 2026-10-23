import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateRecipe, FIT_LABEL_ES, nominalServing, type RecipeFit } from "@nutriduo/portion-engine";
import { requireContext, personTone } from "@/lib/session";
import { loadIngredients, loadRecipeVersion } from "@/lib/data/catalog";
import { CATEGORY_LABEL, CATEGORY_SLOT } from "@/lib/data/editor";
import { participantInputs } from "@/lib/engines/budget";
import { todayIn } from "@/lib/dates";
import { grams, kcal, macro, STATE_LABEL } from "@/lib/format";
import { num, type RecipeRow, type RecipeVersionRow } from "@/lib/types";
import { Button, LinkButton, PageHeader, Panel, PersonDot, SectionTitle, Tag } from "@/components/ui";
import { archiveRecipe, setCurrentVersion, toggleFavorite } from "../actions";

export const metadata: Metadata = { title: "Receta" };

const ROLE: Record<string, string> = { fixed: "fijo", adjustable: "se ajusta", ratio: "en proporción", side: "acompañamiento" };
const FIT_TONE: Record<RecipeFit, "ok" | "neutral" | "warn" | "error"> = {
  suitable: "ok",
  suitable_with_adjustments: "neutral",
  needs_modifications: "warn",
  blocked: "error",
  missing_data: "warn",
};

export default async function RecipePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const { data: rec } = await ctx.supabase.from("recipes").select("*").eq("id", id).maybeSingle();
  if (!rec) notFound();
  const recipe = rec as RecipeRow;
  const { data: vs } = await ctx.supabase.from("recipe_versions").select("*").eq("recipe_id", id).order("version_no", { ascending: false });
  const versions = (vs ?? []) as RecipeVersionRow[];
  const versionId = sp.v ?? recipe.current_version_id ?? versions[0]?.id;
  if (!versionId) notFound();
  const { version, row, lines } = await loadRecipeVersion(ctx.supabase, versionId);
  const ingredients = await loadIngredients(ctx.supabase, version.lines.map((l) => l.ingredientId), ctx.household.id);
  const serving = nominalServing(version, ingredients);

  // Evaluación individual: cada perfil con su propio presupuesto para el tiempo de comida típico
  const slot = CATEGORY_SLOT[recipe.category] ?? "lunch";
  const today = todayIn(ctx.household.timezone);
  const evaluations = await Promise.all(
    ctx.people.map(async (p) => {
      const inp = await participantInputs(ctx.supabase, p.profile_id, today, slot, null);
      if (!inp.target) return { person: p, evaluation: null, reason: p.is_me ? inp.problem : `${p.display_name} no comparte su meta.` };
      return { person: p, evaluation: evaluateRecipe({ recipe: version, ingredients, target: inp.target, goal: inp.goalType, restrictions: inp.restrictions, preferences: inp.preferences }), reason: null };
    }),
  );

  return (
    <>
      <PageHeader
        title={recipe.name}
        lead={
          <>
            {`${CATEGORY_LABEL[recipe.category]}, rinde ${num(row.servings_nominal)} porciones${recipe.prep_minutes ? `, ${recipe.prep_minutes} min` : ""}${row.is_homogeneous ? ", se reparte como preparación terminada" : ""}.`}
            {recipe.catalog_slug ? <span className="ml-2 align-middle"><Tag>Recetario base</Tag></span> : null}
          </>
        }
        actions={
          <>
            <form action={toggleFavorite}>
              <input type="hidden" name="id" value={recipe.id} />
              <input type="hidden" name="favorite" value={String(recipe.favorite)} />
              <Button kind="quiet">{recipe.favorite ? "Quitar de favoritas" : "Marcar favorita"}</Button>
            </form>
            <LinkButton href={`/recetas/${recipe.id}/editar?desde=${version.id}`} kind="quiet">Crear versión nueva</LinkButton>
            <LinkButton href={`/calendario/nuevo?receta=${recipe.id}`}>Añadir al calendario</LinkButton>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Panel>
            <SectionTitle aside={<span className="text-sm text-tinta-suave">versión {row.version_no}{row.version_no > 1 && row.change_log[0] ? `: ${row.change_log[0].change}` : ""}</span>}>
              Ingredientes por porción
            </SectionTitle>
            <table className="cifra w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.position} className="border-t border-avena first:border-0">
                    <td className="py-2 pr-2">{ingredients.get(l.ingredient_id)?.name ?? "—"}</td>
                    <td className="py-2 pr-2 text-right font-semibold">{grams(num(l.grams))}</td>
                    <td className="py-2 pr-2 text-tinta-suave">{STATE_LABEL[l.state]}</td>
                    <td className="py-2 text-right text-tinta-suave">{ROLE[l.role]}{l.ratio_group ? ` (${l.ratio_group})` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cifra mt-4 grid grid-cols-2 gap-2 rounded-xl bg-masa p-3 text-sm sm:grid-cols-5">
              <div><p className="text-tinta-suave">Energía</p><p className="font-semibold">{kcal(serving.nutrients.kcal, serving.confidence)}</p></div>
              <div><p className="text-tinta-suave">Proteína</p><p className="font-semibold">{macro(serving.nutrients.protein_g, serving.confidence)}</p></div>
              <div><p className="text-tinta-suave">Carbohidratos</p><p className="font-semibold">{macro(serving.nutrients.carbs_g, serving.confidence)}</p></div>
              <div><p className="text-tinta-suave">Grasas</p><p className="font-semibold">{macro(serving.nutrients.fat_g, serving.confidence)}</p></div>
              <div><p className="text-tinta-suave">Fibra</p><p className="font-semibold">{macro(serving.nutrients.fiber_g, serving.confidence)}</p></div>
            </div>
            {serving.nutrients.sodium_mg != null ? <p className="cifra mt-2 text-xs text-tinta-suave">Sodio ≈ {Math.round(serving.nutrients.sodium_mg)} mg por porción.</p> : null}
            {serving.missing.length ? <p className="mt-2 text-sm text-miel">Faltan datos nutricionales de {serving.missing.length} ingrediente(s): las cifras están incompletas.</p> : null}
          </Panel>

          {row.instructions ? (
            <Panel>
              <SectionTitle>Preparación</SectionTitle>
              <p className="max-w-[70ch] whitespace-pre-line leading-relaxed">{row.instructions}</p>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-5">
          <Panel>
            <SectionTitle>Para cada uno</SectionTitle>
            <ul className="space-y-4">
              {evaluations.map(({ person, evaluation, reason }) => (
                <li key={person.profile_id} className={`tono-${personTone(ctx.people, person.profile_id)} border-l-4 border-[var(--tono)] pl-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <PersonDot tone={personTone(ctx.people, person.profile_id)} name={person.display_name} />
                    {evaluation ? <Tag tone={FIT_TONE[evaluation.fit]}>{FIT_LABEL_ES[evaluation.fit]}</Tag> : null}
                  </div>
                  {evaluation ? (
                    <>
                      <ul className="mt-2 space-y-1 text-sm text-tinta-suave">
                        {evaluation.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                      {evaluation.adjusted && evaluation.adjusted.items.length ? (
                        <p className="cifra mt-2 text-sm">
                          Su porción: {evaluation.adjusted.items.map((i) => `${i.label} ${i.units !== undefined ? `${i.units} u` : grams(i.grams)}`).join(", ")}.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-tinta-suave">{reason}</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-tinta-suave">Evaluado contra el presupuesto típico de {slot === "breakfast" ? "desayuno" : slot === "dinner" ? "cena" : slot === "snack_pm" ? "snack" : "almuerzo"} de cada perfil.</p>
          </Panel>

          <Panel>
            <SectionTitle>Versiones</SectionTitle>
            <ol className="space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-avena px-3 py-2">
                  <div>
                    <Link href={`/recetas/${recipe.id}?v=${v.id}`} className={v.id === version.id ? "font-semibold" : "underline-offset-2 hover:underline"}>
                      Versión {v.version_no} {v.origin === "optimized" ? "(optimizada)" : v.origin === "original" ? "(original)" : ""}
                    </Link>
                    {v.change_log[0] ? <p className="text-tinta-suave">{v.change_log[0].change}{v.change_log[0].why ? `, ${v.change_log[0].why}` : ""}</p> : null}
                  </div>
                  {v.id === recipe.current_version_id ? (
                    <Tag tone="ok">Vigente</Tag>
                  ) : (
                    <form action={setCurrentVersion}>
                      <input type="hidden" name="recipe_id" value={recipe.id} />
                      <input type="hidden" name="version_id" value={v.id} />
                      <button className="text-sm text-salvia-oscuro underline-offset-2 hover:underline">Usar esta</button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
          <form action={archiveRecipe}>
            <input type="hidden" name="id" value={recipe.id} />
            <Button kind="ghost" className="px-0 text-sm">Archivar receta</Button>
          </form>
        </div>
      </div>
    </>
  );
}
