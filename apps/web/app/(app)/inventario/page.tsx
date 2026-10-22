import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/session";
import { grams, STATE_LABEL } from "@/lib/format";
import { longDate, todayIn, addDays } from "@/lib/dates";
import { num } from "@/lib/types";
import { Button, Empty, PageHeader, Panel, SectionTitle, Tag } from "@/components/ui";

export const metadata: Metadata = { title: "Inventario" };

const LOCATION: Record<string, string> = { pantry: "Despensa", fridge: "Refrigerador", freezer: "Congelador" };

async function addItem(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const d = z
    .object({
      ingredient_id: z.string().uuid(),
      grams: z.coerce.number().positive().max(100000),
      state: z.enum(["raw", "cooked", "as_sold"]),
      location: z.enum(["pantry", "fridge", "freezer"]),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    })
    .safeParse({ ingredient_id: fd.get("ingredient_id"), grams: fd.get("grams"), state: fd.get("state"), location: fd.get("location"), expires_on: fd.get("expires_on") || null });
  if (!d.success) return;
  await ctx.supabase.from("inventory_items").insert({ household_id: ctx.household.id, ...d.data });
  revalidatePath("/inventario");
}

async function updateGrams(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const g = Number(fd.get("grams"));
  const id = String(fd.get("id"));
  if (!Number.isFinite(g) || g < 0) return;
  if (g === 0) await ctx.supabase.from("inventory_items").delete().eq("id", id);
  else await ctx.supabase.from("inventory_items").update({ grams: g }).eq("id", id);
  revalidatePath("/inventario");
}

export default async function InventoryPage() {
  const ctx = await requireContext();
  const today = todayIn(ctx.household.timezone);
  const [{ data: items }, { data: ingredients }] = await Promise.all([
    ctx.supabase.from("inventory_items").select("id, grams, state, location, expires_on, opened, ingredient_id, ingredients(name), inventory_reservations(grams)").eq("household_id", ctx.household.id).order("expires_on", { ascending: true, nullsFirst: false }),
    ctx.supabase.from("ingredients").select("id, name, default_state").order("name"),
  ]);
  const rows = (items ?? []) as unknown as { id: string; grams: number; state: string; location: string; expires_on: string | null; ingredients: { name: string } | null; inventory_reservations: { grams: number }[] }[];
  const soon = addDays(today, 3);

  return (
    <>
      <PageHeader title="Inventario" lead="Lo que hay en casa. La lista de compras lo descuenta automáticamente." />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Panel className="p-0 sm:p-0">
          {rows.length === 0 ? (
            <div className="p-5"><Empty title="La despensa está vacía">Agrega lo que tienes, o desde Compras pasa lo que compraste.</Empty></div>
          ) : (
            <ul className="divide-y divide-avena">
              {rows.map((r) => {
                const reserved = r.inventory_reservations.reduce((a, x) => a + num(x.grams), 0);
                const expiring = r.expires_on && r.expires_on <= soon;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="font-medium">{r.ingredients?.name ?? "—"} <span className="text-sm font-normal text-tinta-suave">{STATE_LABEL[r.state]}</span></p>
                      <p className="text-sm text-tinta-suave">
                        {LOCATION[r.location]}
                        {r.expires_on ? `, vence el ${longDate(r.expires_on)}` : ""}
                        {reserved > 0 ? `, ${grams(reserved)} reservados` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {expiring ? <Tag tone={r.expires_on! < today ? "error" : "warn"}>{r.expires_on! < today ? "Vencido" : "Vence pronto"}</Tag> : null}
                      <form action={updateGrams} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="grams" type="number" min={0} defaultValue={num(r.grams)} className="campo cifra w-24 py-1.5" aria-label={`Gramos de ${r.ingredients?.name}`} />
                        <span className="text-sm text-tinta-suave">g</span>
                        <Button kind="ghost" className="px-2 py-1.5">Guardar</Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel className="h-fit">
          <SectionTitle>Agregar</SectionTitle>
          <form action={addItem} className="space-y-3">
            <select name="ingredient_id" className="campo" required aria-label="Ingrediente" defaultValue="">
              <option value="" disabled>Ingrediente…</option>
              {(ingredients ?? []).map((i) => <option key={i.id as string} value={i.id as string}>{i.name as string}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input name="grams" type="number" min={1} className="campo cifra" placeholder="Gramos" required />
              <select name="state" className="campo" defaultValue="raw" aria-label="Estado">
                <option value="raw">Crudo</option>
                <option value="as_sold">Como se vende</option>
                <option value="cooked">Cocido</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select name="location" className="campo" defaultValue="pantry" aria-label="Ubicación">
                <option value="pantry">Despensa</option>
                <option value="fridge">Refrigerador</option>
                <option value="freezer">Congelador</option>
              </select>
              <input name="expires_on" type="date" className="campo" aria-label="Vence" />
            </div>
            <Button kind="quiet" className="w-full">Agregar al inventario</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
