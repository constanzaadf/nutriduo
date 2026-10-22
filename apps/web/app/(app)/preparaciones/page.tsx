import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nominalMix } from "@nutriduo/portion-engine";
import { requireContext } from "@/lib/session";
import { loadIngredients, loadRecipeVersion } from "@/lib/data/catalog";
import { addDays, longDate, todayIn } from "@/lib/dates";
import { grams } from "@/lib/format";
import { num } from "@/lib/types";
import { SLOT_LABEL } from "@/lib/data/week";
import { Button, Empty, PageHeader, Panel, SectionTitle, Tag } from "@/components/ui";

export const metadata: Metadata = { title: "Preparaciones" };

async function planBatch(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const d = z
    .object({ recipe_id: z.string().uuid(), servings: z.coerce.number().positive().max(50), planned_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), location: z.enum(["fridge", "freezer"]) })
    .safeParse({ recipe_id: fd.get("recipe_id"), servings: fd.get("servings"), planned_for: fd.get("planned_for"), location: fd.get("location") });
  if (!d.success) return;
  const { data: r } = await ctx.supabase.from("recipes").select("current_version_id").eq("id", d.data.recipe_id).single();
  if (!r?.current_version_id) return;
  const { version } = await loadRecipeVersion(ctx.supabase, r.current_version_id);
  const ingredients = await loadIngredients(ctx.supabase, version.lines.map((l) => l.ingredientId));
  // La olla: líneas que no son acompañamiento, escaladas a las porciones pedidas
  const mix = nominalMix(version, ingredients);
  const scale = d.data.servings / version.servingsNominal;
  await ctx.supabase.from("cooking_batches").insert({
    household_id: ctx.household.id,
    recipe_version_id: version.id,
    status: "planned",
    planned_for: d.data.planned_for,
    raw_input: mix.rawLines.map((l) => ({ ingredientId: l.ingredientId, grams: Math.round(l.grams * scale), state: l.state })),
    expected_cooked_g: Math.round(mix.cookedTotalG * scale),
    location: d.data.location,
    frozen: d.data.location === "freezer",
    use_by: addDays(d.data.planned_for, d.data.location === "freezer" ? 60 : 3),
  });
  revalidatePath("/preparaciones");
}

async function markCooked(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const g = Number(fd.get("cooked_total_g"));
  if (!Number.isFinite(g) || g <= 0) return;
  await ctx.supabase.rpc("mark_batch_cooked", { p_batch: String(fd.get("batch_id")), p_cooked_total_g: g, p_measured: true });
  revalidatePath("/preparaciones");
}

async function storeRemainder(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const g = Number(fd.get("grams"));
  const dest = fd.get("destination") === "freezer" ? "freezer" : "fridge";
  if (!Number.isFinite(g) || g <= 0) return;
  await ctx.supabase.from("batch_allocations").insert({ batch_id: String(fd.get("batch_id")), destination: dest, grams_cooked: g });
  revalidatePath("/preparaciones");
}

async function finishBatch(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  await ctx.supabase.from("cooking_batches").update({ status: "finished" }).eq("id", String(fd.get("batch_id")));
  revalidatePath("/preparaciones");
}

export default async function BatchesPage() {
  const ctx = await requireContext();
  const today = todayIn(ctx.household.timezone);
  const [{ data: batches }, { data: recipes }] = await Promise.all([
    ctx.supabase
      .from("cooking_batches")
      .select("*, recipe_versions(name), batch_allocations(id, grams_cooked, destination, event_id, meal_events(date, slot))")
      .eq("household_id", ctx.household.id)
      .in("status", ["planned", "cooked"])
      .order("planned_for"),
    ctx.supabase.from("recipes").select("id, name, recipe_versions!recipes_current_version_fk(is_homogeneous)").eq("archived", false).order("name"),
  ]);
  const list = (batches ?? []) as unknown as {
    id: string;
    status: string;
    planned_for: string | null;
    cooked_on: string | null;
    expected_cooked_g: number | null;
    cooked_total_g: number | null;
    measured: boolean;
    location: string;
    use_by: string | null;
    recipe_versions: { name: string } | null;
    batch_allocations: { id: string; grams_cooked: number; destination: string; event_id: string | null; meal_events: { date: string; slot: keyof typeof SLOT_LABEL } | null }[];
  }[];
  const homogeneous = ((recipes ?? []) as unknown as { id: string; name: string; recipe_versions: { is_homogeneous: boolean } | null }[]).filter((r) => r.recipe_versions?.is_homogeneous);

  return (
    <>
      <PageHeader title="Preparaciones" lead="Cocinar una vez y repartir en varios días. Pesa la olla al terminar: con el peso real, cada porción queda exacta." />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {list.length === 0 ? (
            <Empty title="No hay lotes en curso">Planifica una preparación (una boloñesa, unas lentejas) y luego úsala desde el calendario.</Empty>
          ) : (
            list.map((b) => {
              const total = num(b.cooked_total_g ?? b.expected_cooked_g ?? 0);
              const used = b.batch_allocations.reduce((a, x) => a + num(x.grams_cooked), 0);
              const free = Math.max(0, total - used);
              return (
                <Panel key={b.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold">{b.recipe_versions?.name}</h2>
                      <p className="text-sm text-tinta-suave">
                        {b.status === "planned" ? `Para cocinar el ${longDate(b.planned_for!)}` : `Cocinado el ${longDate(b.cooked_on!)}`}
                        {b.use_by ? `, consumir antes del ${longDate(b.use_by)}` : ""}
                      </p>
                    </div>
                    <Tag tone={b.measured ? "ok" : "warn"}>{b.measured ? `Pesado: ${grams(total)}` : `Estimado: ≈ ${grams(total)}`}</Tag>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-avena/60" role="meter" aria-valuenow={used} aria-valuemax={total} aria-label="Asignado del lote">
                    <div className="h-full bg-salvia" style={{ width: `${total ? Math.min(100, (used / total) * 100) : 0}%` }} />
                  </div>
                  <p className="cifra mt-1 text-sm text-tinta-suave">{grams(used)} asignados, {grams(free)} libres</p>
                  {b.batch_allocations.length ? (
                    <ul className="cifra mt-3 space-y-1 text-sm">
                      {b.batch_allocations.map((a) => (
                        <li key={a.id} className="flex justify-between gap-3">
                          <span>{a.destination === "meal" && a.meal_events ? <Link href={`/calendario/evento/${a.event_id}`} className="underline-offset-2 hover:underline">{SLOT_LABEL[a.meal_events.slot]} del {longDate(a.meal_events.date)}</Link> : a.destination === "freezer" ? "Congelador" : "Refrigerador"}</span>
                          <span className="font-semibold">{grams(num(a.grams_cooked))}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-3">
                    {b.status === "planned" || !b.measured ? (
                      <form action={markCooked} className="flex items-end gap-2">
                        <input type="hidden" name="batch_id" value={b.id} />
                        <label className="text-sm">
                          <span className="etiqueta">Peso final (sin la olla)</span>
                          <input name="cooked_total_g" type="number" min={1} className="campo cifra w-32" placeholder="g" required />
                        </label>
                        <Button kind="quiet">Registrar peso</Button>
                      </form>
                    ) : null}
                    {free > 0 && b.status === "cooked" ? (
                      <form action={storeRemainder} className="flex items-end gap-2">
                        <input type="hidden" name="batch_id" value={b.id} />
                        <input name="grams" type="number" min={1} max={Math.floor(free)} defaultValue={Math.floor(free)} className="campo cifra w-24" aria-label="Gramos a guardar" />
                        <select name="destination" className="campo w-36" aria-label="Destino" defaultValue="freezer">
                          <option value="freezer">Congelar</option>
                          <option value="fridge">Refrigerar</option>
                        </select>
                        <Button kind="quiet">Guardar</Button>
                      </form>
                    ) : null}
                    {b.status === "cooked" ? (
                      <form action={finishBatch}>
                        <input type="hidden" name="batch_id" value={b.id} />
                        <Button kind="ghost">Marcar terminado</Button>
                      </form>
                    ) : null}
                  </div>
                </Panel>
              );
            })
          )}
        </div>
        <Panel className="h-fit">
          <SectionTitle>Planificar un lote</SectionTitle>
          {homogeneous.length === 0 ? (
            <p className="text-sm text-tinta-suave">Los lotes son para preparaciones que se reparten por peso (guisos, salsas). Marca una receta como “mezcla que no se separa” para usarla aquí.</p>
          ) : (
            <form action={planBatch} className="space-y-3">
              <select name="recipe_id" className="campo" aria-label="Receta" required>
                {homogeneous.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm"><span className="etiqueta">Porciones</span><input name="servings" type="number" min={1} step={0.5} defaultValue={6} className="campo cifra" /></label>
                <label className="text-sm"><span className="etiqueta">Día</span><input name="planned_for" type="date" defaultValue={today} className="campo" /></label>
              </div>
              <select name="location" className="campo" aria-label="Dónde se guarda" defaultValue="fridge">
                <option value="fridge">Se guarda en el refrigerador</option>
                <option value="freezer">Se congela</option>
              </select>
              <Button className="w-full">Planificar lote</Button>
              <p className="text-xs text-tinta-suave">Sus ingredientes entran a la lista de compras de esa semana. En el calendario, elige “Sale de un lote” para usarlo.</p>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}
