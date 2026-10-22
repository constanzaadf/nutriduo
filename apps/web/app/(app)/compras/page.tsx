import type { Metadata } from "next";
import Link from "next/link";
import { meaningfulChanges } from "@nutriduo/shopping-engine";
import { requireContext } from "@/lib/session";
import { computeWeekShopping } from "@/lib/engines/shopping";
import { isoWeekOf, shiftWeek, todayIn, weekDays, weekRangeLabel } from "@/lib/dates";
import { grams, money } from "@/lib/format";
import { num, type ShoppingItemRow } from "@/lib/types";
import { Button, Empty, Notice, PageHeader, Panel, cx } from "@/components/ui";
import { addManualItem, applyShopping, moveCheckedToPantry, removeItem, toggleItem } from "./actions";
import { ShareButton } from "./share-button";

export const metadata: Metadata = { title: "Compras" };

const CATEGORY: Record<string, string> = {
  verduras: "Verduras", frutas: "Frutas", carnes: "Carnes", pescados: "Pescados", huevos: "Huevos", lacteos: "Lácteos",
  panaderia: "Panadería", cereales: "Cereales y pastas", legumbres: "Legumbres", frutos_secos: "Frutos secos",
  grasas: "Aceites", condimentos: "Condimentos", bebidas: "Bebidas", otros: "Otros",
};
const DIFF_LABEL: Record<string, string> = { added: "Nuevo", removed: "Ya no se necesita", increased: "Sube", decreased: "Baja", orphan_checked: "Comprado, ya no se usa" };

export default async function ShoppingPage({ searchParams }: { searchParams: Promise<{ semana?: string; revisar?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const week = sp.semana && /^\d{4}-W\d{2}$/.test(sp.semana) ? sp.semana : isoWeekOf(todayIn(ctx.household.timezone));
  const { data: planRow } = await ctx.supabase.from("meal_plans").select("id").eq("household_id", ctx.household.id).eq("iso_week", week).maybeSingle();
  const { data: listRow } = planRow ? await ctx.supabase.from("shopping_lists").select("id").eq("plan_id", planRow.id).eq("status", "active").maybeSingle() : { data: null };
  const { data: itemRows } = listRow ? await ctx.supabase.from("shopping_list_items").select("*").eq("list_id", listRow.id).order("position") : { data: [] };
  const items = (itemRows ?? []) as ShoppingItemRow[];

  // El diff se calcula siempre (es barato) para avisar si el calendario cambió
  const shop = planRow ? await computeWeekShopping(ctx.supabase, ctx.household.id, week) : null;
  const changes = shop ? meaningfulChanges(shop.diff) : [];
  const groups = Object.entries(
    items.reduce<Record<string, ShoppingItemRow[]>>((acc, i) => {
      (acc[i.manual ? "manual" : i.category] ??= []).push(i);
      return acc;
    }, {}),
  ).sort(([a], [b]) => (a === "manual" ? 1 : b === "manual" ? -1 : Object.keys(CATEGORY).indexOf(a) - Object.keys(CATEGORY).indexOf(b)));
  const total = items.reduce((a, i) => a + num(i.estimated_price ?? 0), 0);
  const left = items.filter((i) => !i.checked && (num(i.buy_g) > 0 || i.manual)).length;

  return (
    <>
      <PageHeader
        title="Compras"
        lead={`Semana del ${weekRangeLabel(week)}. Una sola lista para el hogar.`}
        actions={listRow ? <ShareButton week={week} /> : null}
      />
      <div className="mb-4 flex items-center gap-1">
        <Link href={`/compras?semana=${shiftWeek(week, -1)}`} className="rounded-full border border-avena px-3 py-1.5 text-sm" aria-label="Semana anterior">‹</Link>
        <Link href={`/compras?semana=${shiftWeek(week, 1)}`} className="rounded-full border border-avena px-3 py-1.5 text-sm" aria-label="Semana siguiente">›</Link>
        <span className="ml-2 text-sm text-tinta-suave">{left} por comprar{total > 0 ? `, ${money(total, ctx.household.currency)} estimado` : ""}</span>
      </div>

      {changes.length > 0 ? (
        <Panel className="mb-5 border-miel/50 bg-miel-claro/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">{items.length === 0 ? `Hay ${changes.length} ingredientes para armar la lista` : `${changes.length} cambios desde la última revisión`}</p>
            <div className="flex gap-2">
              {sp.revisar ? null : <Link href={`/compras?semana=${week}&revisar=1`} className="rounded-full border border-avena-fuerte bg-papel px-4 py-2 text-sm font-semibold">Ver cambios</Link>}
              <form action={applyShopping}>
                <input type="hidden" name="semana" value={week} />
                <Button>{items.length === 0 ? "Generar lista" : "Aplicar cambios"}</Button>
              </form>
            </div>
          </div>
          {sp.revisar ? (
            <ul className="cifra mt-3 space-y-1 text-sm">
              {changes.map((c) => (
                <li key={c.key} className="flex justify-between gap-3">
                  <span>{c.label} <span className="text-tinta-suave">({DIFF_LABEL[c.kind]})</span></span>
                  <span>{c.kind === "added" ? grams(c.toG) : c.kind === "removed" || c.kind === "orphan_checked" ? grams(c.fromG) : `${grams(c.fromG)} a ${grams(c.toG)}`}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-tinta-suave">Lo que ya marcaste como comprado y lo que agregaste a mano se conserva.</p>
        </Panel>
      ) : null}

      {!planRow ? (
        <Empty title="No hay comidas planificadas esta semana" action={<Link href={`/calendario/nuevo?fecha=${weekDays(week)[0]}`} className="font-semibold text-salvia-oscuro underline">Planificar</Link>}>
          La lista se arma sola a partir del calendario.
        </Empty>
      ) : items.length === 0 && changes.length === 0 ? (
        <Empty title="Lista vacía">Aprueba porciones en el calendario y aquí aparecerá lo que hay que comprar.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-5">
            {groups.map(([cat, list]) => (
              <section key={cat}>
                <h2 className="mb-2 text-base font-semibold text-tinta-suave">{cat === "manual" ? "Agregado a mano" : CATEGORY[cat] ?? cat}</h2>
                <ul className="divide-y divide-avena overflow-hidden rounded-2xl border border-avena bg-papel">
                  {list.map((i) => {
                    const missing = i.checked_g > 0 && num(i.checked_g) < num(i.buy_g);
                    const zero = !i.manual && num(i.buy_g) <= 0;
                    return (
                      <li key={i.id} className={cx("flex items-start gap-3 px-4 py-3", (i.checked || zero) && "text-tinta-suave")}>
                        <form action={toggleItem}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="checked" value={String(i.checked)} />
                          <input type="hidden" name="buy_g" value={num(i.buy_g)} />
                          <button
                            className={cx("mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border-2", i.checked ? "border-salvia bg-salvia text-papel" : "border-avena-fuerte")}
                            aria-label={i.checked ? `Desmarcar ${i.label}` : `Marcar ${i.label} como comprado`}
                            aria-pressed={i.checked}
                          >
                            {i.checked ? "✓" : ""}
                          </button>
                        </form>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className={cx("font-medium", i.checked && "line-through")}>{i.label}</span>
                            <span className="cifra whitespace-nowrap font-semibold">{i.manual ? (i.manual_quantity ?? "") : zero ? "Ya lo tienes" : grams(num(i.buy_g))}</span>
                          </div>
                          {i.pack_suggestion && !i.checked ? (
                            <p className="cifra text-sm text-tinta-suave">
                              Compra {i.pack_suggestion.packs.map((p) => `${p.count} × ${p.label}`).join(" + ")}
                              {i.pack_suggestion.surplusG >= 1 ? `, sobran ${grams(i.pack_suggestion.surplusG)}` : ""}
                            </p>
                          ) : null}
                          {num(i.available_g) > 0 && !i.manual ? <p className="cifra text-sm text-tinta-suave">Necesitas {grams(num(i.need_g))}; en casa hay {grams(num(i.available_g))}.</p> : null}
                          {missing ? <p className="text-sm text-miel">Ya compraste {grams(num(i.checked_g))}; faltan {grams(num(i.buy_g) - num(i.checked_g))}.</p> : null}
                        </div>
                        {i.manual ? (
                          <form action={removeItem}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="text-sm text-tinta-suave" aria-label={`Quitar ${i.label}`}>×</button>
                          </form>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {listRow ? (
            <aside className="space-y-4">
              <Panel>
                <form action={addManualItem} className="space-y-2">
                  <input type="hidden" name="list_id" value={listRow.id} />
                  <label className="etiqueta" htmlFor="label">Agregar a mano</label>
                  <input id="label" name="label" className="campo" placeholder="Papel de cocina" required />
                  <input name="quantity" className="campo" placeholder="Cantidad (opcional)" />
                  <Button kind="quiet" className="w-full">Agregar</Button>
                </form>
              </Panel>
              <Panel>
                <form action={moveCheckedToPantry} className="space-y-2">
                  <input type="hidden" name="list_id" value={listRow.id} />
                  <p className="text-sm text-tinta-suave">¿Volviste del supermercado? Pasa lo marcado al inventario para que la próxima lista lo descuente.</p>
                  <Button kind="quiet" className="w-full">Pasar lo comprado al inventario</Button>
                </form>
              </Panel>
              <Notice>Cantidades netas: lo que piden las recetas menos lo que hay en casa. Si cargas el envase habitual de un ingrediente, la lista sugiere cuántos comprar.</Notice>
            </aside>
          ) : null}
        </div>
      )}
    </>
  );
}
