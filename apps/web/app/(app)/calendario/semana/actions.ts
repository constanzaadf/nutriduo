"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { computeMeal } from "@/lib/engines/meal";
import { batchRows, parseWeekMenuOptions, proposeWeekMenu } from "@/lib/engines/week-menu";
import { isoWeekOf, todayIn } from "@/lib/dates";

function query(o: ReturnType<typeof parseWeekMenuOptions>, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({
    semana: o.week,
    variante: String(o.seed),
    ollas: String(o.pots),
    cenas: o.weekdayDinner === "fresh" ? "dia" : "olla",
    desayuno: o.breakfast ? "si" : "no",
    ...extra,
  });
  return p.toString();
}

/**
 * Aplica la propuesta: crea lotes y comidas en una transacción y luego
 * calcula y aprueba las porciones de cada comida (así entran a la lista de
 * compras). Recalcula la propuesta en el servidor y solo la aplica si es la
 * misma que se revisó.
 */
export async function applyWeekMenu(fd: FormData) {
  const ctx = await requireContext();
  const raw = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  const o = parseWeekMenuOptions(raw, isoWeekOf(todayIn(ctx.household.timezone)));
  const r = await proposeWeekMenu(ctx, o);
  if (r.proposal.trace.inputHash !== raw.hash) redirect(`/calendario/semana?${query(o, { aviso: "cambio" })}`);
  if (r.proposal.events.length === 0) redirect(`/calendario/semana?${query(o)}`);

  const events = r.proposal.events.map((e) => ({
    date: e.date,
    slot: e.slot,
    mode: e.participantIds.length === 1 && e.mode === "A" ? "B" : e.mode,
    recipe_version_id: e.versionId,
    batch_key: e.batchKey ? `${e.batchKey}:${e.storage}` : null,
    profiles: e.participantIds,
    skip_sides: Object.fromEntries(e.portions.filter((x) => x.skipSides.length).map((x) => [x.participantId, x.skipSides])),
  }));
  const { data, error } = await ctx.supabase.rpc("apply_week_menu", { p_household: ctx.household.id, p_batches: batchRows(r.proposal), p_events: events });
  if (error) {
    redirect(`/calendario/semana?${query(o, { aviso: error.hint === "slot_taken" ? "ocupado" : "error" })}`);
  }
  const ids = ((data as { events: string[] }).events ?? []) as string[];

  // Porciones: los días en paralelo; dentro de un día en orden, porque cada comida
  // aprobada ajusta el presupuesto de las que quedan ese día.
  const names = Object.fromEntries(ctx.people.map((p) => [p.profile_id, p.display_name]));
  const byDay = new Map<string, string[]>();
  r.proposal.events.forEach((e, i) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), ids[i]!]));
  const results = await Promise.all(
    [...byDay.values()].map(async (dayIds) => {
      let ok = 0;
      for (const id of dayIds) {
        try {
          const c = await computeMeal(ctx.supabase, id, { persist: true, names });
          if (c.persisted) ok++;
        } catch {
          // queda en borrador; se revisa desde el calendario
        }
      }
      return { ok, total: dayIds.length };
    }),
  );
  const approved = results.reduce((a, x) => a + x.ok, 0);

  revalidatePath("/calendario");
  revalidatePath("/preparaciones");
  revalidatePath("/compras");
  revalidatePath("/dashboard");
  redirect(`/calendario?semana=${o.week}&menu=${ids.length}&pendientes=${ids.length - approved}`);
}
