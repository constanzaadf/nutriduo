import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/session";
import { num } from "@/lib/types";
import { EXCHANGE_GROUPS, FOOD_STATE_LABEL, INGREDIENT_CATEGORIES } from "@/lib/data/labels";
import { Button, Empty, PageHeader, Panel, SectionTitle, Tag, cx } from "@/components/ui";
import { IngredientForm } from "./ingredient-form";
import { deleteIngredient, setExchangeOverride } from "./actions";

export const metadata: Metadata = { title: "Ingredientes" };

const SOURCE: Record<string, string> = { label: "Etiqueta", fdc: "USDA FDC", manual: "Manual (estimado)", exchange_table: "Tabla" };
const CAT = Object.fromEntries(INGREDIENT_CATEGORIES);
const GROUP = Object.fromEntries(EXCHANGE_GROUPS);
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");

type Row = {
  id: string;
  household_id: string | null;
  catalog_slug: string | null;
  name: string;
  category: string;
  default_state: string;
  allergen_tags: string[];
  unit_weight_g: number | null;
  exchange_group_code: string | null;
  exchange_grams: number | null;
  exchange_state: string | null;
  ingredient_nutrition: { state: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; source: string; source_ref: string | null }[];
  ingredient_yields: { yield_factor: number }[];
};
type Override = { ingredient_id: string; exchange_group_code: string | null; exchange_grams: number | null; note: string | null };

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; ver?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  let query = ctx.supabase
    .from("ingredients")
    .select(
      "id, household_id, catalog_slug, name, category, default_state, allergen_tags, unit_weight_g, exchange_group_code, exchange_grams, exchange_state, ingredient_nutrition(state, kcal, protein_g, carbs_g, fat_g, source, source_ref), ingredient_yields(yield_factor)",
    )
    .order("name");
  if (sp.q) query = query.ilike("name", `%${sp.q.replace(/[%_]/g, "")}%`);
  if (sp.cat) query = query.eq("category", sp.cat);
  if (sp.ver === "propios") query = query.not("household_id", "is", null);
  if (sp.ver === "catalogo") query = query.is("household_id", null);
  const [{ data }, { data: ovr }, { count: total }] = await Promise.all([
    query,
    ctx.supabase.from("household_ingredient_overrides").select("ingredient_id, exchange_group_code, exchange_grams, note").eq("household_id", ctx.household.id),
    ctx.supabase.from("ingredients").select("id", { count: "exact", head: true }),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const overrides = new Map(((ovr ?? []) as Override[]).map((o) => [o.ingredient_id, o]));

  const groups = INGREDIENT_CATEGORIES.map(([code, label]) => ({ code, label, items: rows.filter((r) => r.category === code) })).filter((g) => g.items.length);
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = next.toString();
    return `/ingredientes${qs ? `?${qs}` : ""}`;
  };
  const chip = (active: boolean) => cx("rounded-full border px-3 py-1", active ? "border-salvia bg-salvia-claro" : "border-avena");

  return (
    <>
      <PageHeader
        title="Ingredientes"
        lead={
          <>
            {total ?? 0} ingredientes. Los del catálogo traen sus valores por 100 g desde la base pública USDA SR28 (cada uno cita su código NDB). Los que
            compras con etiqueta, agrégalos con los datos del envase.
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <form className="flex flex-wrap gap-2" role="search">
            <input name="q" defaultValue={sp.q} className="campo max-w-xs" placeholder="Buscar ingrediente" aria-label="Buscar ingrediente" />
            {sp.cat ? <input type="hidden" name="cat" value={sp.cat} /> : null}
            {sp.ver ? <input type="hidden" name="ver" value={sp.ver} /> : null}
          </form>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={link({ ver: undefined })} className={chip(!sp.ver)}>Todos</Link>
            <Link href={link({ ver: "catalogo" })} className={chip(sp.ver === "catalogo")}>Catálogo</Link>
            <Link href={link({ ver: "propios" })} className={chip(sp.ver === "propios")}>Del hogar</Link>
            <span className="mx-1 self-center text-avena-fuerte" aria-hidden>|</span>
            <Link href={link({ cat: undefined })} className={chip(!sp.cat)}>Todas las categorías</Link>
            {INGREDIENT_CATEGORIES.map(([k, v]) => (
              <Link key={k} href={link({ cat: sp.cat === k ? undefined : k })} className={chip(sp.cat === k)}>{v}</Link>
            ))}
          </div>

          {groups.length === 0 ? (
            <Panel>
              <Empty title={sp.q || sp.cat || sp.ver ? "Nada con ese filtro" : "Aún no hay ingredientes"}>
                {sp.q || sp.cat || sp.ver ? "Prueba con otra palabra o quita los filtros." : "Agrega los que más usan; cada uno sirve para todas las recetas del hogar."}
              </Empty>
            </Panel>
          ) : (
            groups.map((g) => (
              <Panel key={g.code} className="p-0 sm:p-0">
                <h2 className="border-b border-avena px-5 py-3 text-sm font-semibold uppercase tracking-wide text-tinta-suave">
                  {g.label} <span className="font-normal normal-case">({g.items.length})</span>
                </h2>
                <ul className="divide-y divide-avena">
                  {g.items.map((r) => (
                    <IngredientItem key={r.id} r={r} override={overrides.get(r.id)} />
                  ))}
                </ul>
              </Panel>
            ))
          )}
        </div>
        <Panel className="h-fit">
          <SectionTitle>Agregar ingrediente</SectionTitle>
          <IngredientForm />
        </Panel>
      </div>
    </>
  );
}

function IngredientItem({ r, override }: { r: Row; override: Override | undefined }) {
  const nutrition = [...r.ingredient_nutrition].sort((a, b) => (a.state === r.default_state ? -1 : b.state === r.default_state ? 1 : 0));
  const main = nutrition[0];
  const isSr28 = main?.source_ref?.startsWith("USDA SR28");
  const exState = r.exchange_state ?? r.default_state;
  const ex = override
    ? override.exchange_group_code && override.exchange_grams != null
      ? { group: override.exchange_group_code, grams: num(override.exchange_grams), mine: true }
      : null
    : r.exchange_group_code && r.exchange_grams != null
      ? { group: r.exchange_group_code, grams: num(r.exchange_grams), mine: false }
      : null;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{r.name}</p>
          <p className="cifra text-sm text-tinta-suave">
            {nutrition.map((n) => `${Math.round(num(n.kcal))} kcal, P ${fmt(num(n.protein_g))}, C ${fmt(num(n.carbs_g))}, G ${fmt(num(n.fat_g))} por 100 g ${FOOD_STATE_LABEL[n.state]}`).join(" / ") ||
              "Sin datos nutricionales"}
            {r.ingredient_yields[0] ? `, rinde ×${fmt(num(r.ingredient_yields[0].yield_factor))} al cocinar` : ""}
            {r.unit_weight_g ? `, 1 unidad ≈ ${fmt(num(r.unit_weight_g))} g` : ""}
          </p>
          <p className="mt-0.5 text-sm">
            {ex ? (
              <>
                1 porción de intercambio ({GROUP[ex.group] ?? ex.group}) = <span className="cifra">{fmt(ex.grams)} g</span> {FOOD_STATE_LABEL[exState]}
                <span className="ml-1.5 text-tinta-suave">{ex.mine ? "· ajustado a tu pauta" : r.catalog_slug ? "· estimado: verifícalo con tu pauta" : ""}</span>
              </>
            ) : (
              <span className="text-tinta-suave">{override ? "No cuenta como intercambio en tu pauta" : "Sin grupo de intercambio"}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {main ? <span title={main.source_ref ?? undefined}><Tag>{isSr28 ? "USDA SR28" : SOURCE[main.source]}</Tag></span> : null}
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
      </div>
      {r.household_id ? null : (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-salvia-oscuro">Ajustar porción de intercambio a mi pauta</summary>
          <form action={setExchangeOverride} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="ingredient_id" value={r.id} />
            <input type="hidden" name="mode" value="set" />
            <label className="grid gap-1">
              <span className="text-tinta-suave">Grupo</span>
              <select name="exchange_group_code" className="campo" defaultValue={ex?.group ?? ""} required>
                <option value="" disabled>Elige</option>
                {EXCHANGE_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-tinta-suave">Gramos por porción ({FOOD_STATE_LABEL[exState]})</span>
              <input name="exchange_grams" type="number" step="0.1" min="0.1" max="2000" defaultValue={ex?.grams ?? ""} className="campo w-28" required />
            </label>
            <label className="grid min-w-40 flex-1 gap-1">
              <span className="text-tinta-suave">Nota (opcional)</span>
              <input name="note" defaultValue={override?.note ?? ""} className="campo" placeholder="p. ej. según pauta de Beatriz" maxLength={200} />
            </label>
            <Button kind="quiet">Guardar</Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-3">
            {ex && !override ? (
              <form action={setExchangeOverride}>
                <input type="hidden" name="ingredient_id" value={r.id} />
                <input type="hidden" name="mode" value="none" />
                <button className="text-tinta-suave hover:text-tinta">Mi pauta no lo cuenta como intercambio</button>
              </form>
            ) : null}
            {override ? (
              <form action={setExchangeOverride}>
                <input type="hidden" name="ingredient_id" value={r.id} />
                <input type="hidden" name="mode" value="reset" />
                <button className="text-tinta-suave hover:text-tinta">Volver al valor del catálogo</button>
              </form>
            ) : null}
          </div>
        </details>
      )}
    </li>
  );
}
