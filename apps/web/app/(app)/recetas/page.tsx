import type { Metadata } from "next";
import Link from "next/link";
import { nominalServing } from "@nutriduo/portion-engine";
import { requireContext } from "@/lib/session";
import { loadIngredients, loadRecipeVersions } from "@/lib/data/catalog";
import { CATEGORY_LABEL } from "@/lib/data/editor";
import type { RecipeRow } from "@/lib/types";
import { Button, Empty, LinkButton, Notice, PageHeader, Tag, cx } from "@/components/ui";
import { importCatalogRecipes } from "./actions";

export const metadata: Metadata = { title: "Recetas" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; tag?: string; fav?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  let query = ctx.supabase.from("recipes").select("*").eq("archived", false).order("favorite", { ascending: false }).order("name");
  if (sp.q) query = query.ilike("name", `%${sp.q}%`);
  if (sp.cat) query = query.eq("category", sp.cat);
  if (sp.tag) query = query.contains("tags", [sp.tag]);
  if (sp.fav) query = query.eq("favorite", true);
  const { data } = await query;
  const recipes = (data ?? []) as RecipeRow[];

  // Macros nominales por porción (estimación de tarjeta; la evaluación por perfil está en el detalle)
  const versions = [...(await loadRecipeVersions(ctx.supabase, recipes.flatMap((r) => (r.current_version_id ? [r.current_version_id] : [])))).values()];
  const ingredients = await loadIngredients(ctx.supabase, versions.flatMap((v) => v.lines.map((l) => l.ingredientId)), ctx.household.id);
  const macros = new Map(versions.map((v) => [v.recipeId, nominalServing(v, ingredients)]));
  const allTags = [...new Set(recipes.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "es"));

  // ¿Faltan recetas del recetario base en este hogar? (p. ej. hogares creados antes del catálogo, o recetas borradas)
  const [{ count: catalogCount }, { count: importedCount }] = await Promise.all([
    ctx.supabase.from("recipe_catalog").select("slug", { count: "exact", head: true }),
    ctx.supabase.from("recipes").select("id", { count: "exact", head: true }).eq("household_id", ctx.household.id).not("catalog_slug", "is", null),
  ]);
  const missing = Math.max(0, (catalogCount ?? 0) - (importedCount ?? 0));

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = next.toString();
    return `/recetas${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Recetas"
        lead="La biblioteca del hogar. Cada receta se evalúa por separado para cada uno."
        actions={
          <>
            <LinkButton href="/ingredientes" kind="quiet">Ingredientes</LinkButton>
            <LinkButton href="/recetas/nueva">Nueva receta</LinkButton>
          </>
        }
      />
      {missing > 0 ? (
        <div className="mb-4">
          <Notice>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {missing === catalogCount ? "El recetario base tiene" : "Faltan"} {missing} receta{missing === 1 ? "" : "s"} del recetario base en tu hogar.
                Se agregan como recetas propias: las puedes editar, versionar o borrar.
              </span>
              <form action={importCatalogRecipes}>
                <Button>Agregar {missing === 1 ? "la receta" : `las ${missing}`}</Button>
              </form>
            </div>
          </Notice>
        </div>
      ) : null}
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} className="campo max-w-xs" placeholder="Buscar receta" aria-label="Buscar" />
        {sp.cat ? <input type="hidden" name="cat" value={sp.cat} /> : null}
      </form>
      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        <Link href={link({ cat: undefined })} className={cx("rounded-full border px-3 py-1", !sp.cat ? "border-salvia bg-salvia-claro" : "border-avena")}>Todas</Link>
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
          <Link key={k} href={link({ cat: k })} className={cx("rounded-full border px-3 py-1", sp.cat === k ? "border-salvia bg-salvia-claro" : "border-avena")}>{v}</Link>
        ))}
        <Link href={link({ fav: sp.fav ? undefined : "1" })} className={cx("rounded-full border px-3 py-1", sp.fav ? "border-salvia bg-salvia-claro" : "border-avena")}>Favoritas</Link>
        {allTags.map((t) => (
          <Link key={t} href={link({ tag: sp.tag === t ? undefined : t })} className={cx("rounded-full border px-3 py-1", sp.tag === t ? "border-ciruela bg-ciruela-claro" : "border-dashed border-avena-fuerte")}>{t}</Link>
        ))}
      </div>

      {recipes.length === 0 ? (
        <Empty title={sp.q || sp.cat || sp.tag ? "Nada con ese filtro" : "Todavía no hay recetas"} action={<LinkButton href="/recetas/nueva">Crear la primera</LinkButton>}>
          Carga una receta con sus ingredientes por porción y la app calcula cuánto le toca a cada uno.
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {recipes.map((r) => {
            const m = macros.get(r.id);
            return (
              <li key={r.id}>
                <Link href={`/recetas/${r.id}`} className="block h-full rounded-[var(--radius-plato)] border border-avena bg-papel p-4 hover:border-avena-fuerte">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold">{r.name}</h2>
                    {r.favorite ? <span aria-label="Favorita" className="text-ciruela">♥</span> : null}
                  </div>
                  <p className="mt-0.5 text-sm text-tinta-suave">
                    {CATEGORY_LABEL[r.category]}
                    {r.prep_minutes ? `, ${r.prep_minutes} min` : ""}
                    {r.catalog_slug ? <span className="ml-2 align-middle"><Tag>Recetario base</Tag></span> : null}
                  </p>
                  {m ? (
                    <p className="cifra mt-3 text-sm">
                      <span className="font-semibold">{m.confidence === "estimated" ? "≈ " : ""}{Math.round(m.nutrients.kcal / 10) * 10} kcal</span>
                      <span className="text-tinta-suave"> por porción nominal, {Math.round(m.nutrients.protein_g)} g proteína</span>
                    </p>
                  ) : null}
                  {r.tags.length ? <div className="mt-3 flex flex-wrap gap-1">{r.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
