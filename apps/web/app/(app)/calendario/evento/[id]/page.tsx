import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CookLine, MixPlan } from "@nutriduo/portion-engine";
import { requireContext, personTone } from "@/lib/session";
import { loadEvents, SLOT_LABEL } from "@/lib/data/week";
import { computeMeal } from "@/lib/engines/meal";
import { isoWeekOf, longDate } from "@/lib/dates";
import { grams, kcal, macro, MODE_LABEL, STATE_LABEL } from "@/lib/format";
import { num, type ConsumptionRow, type PortionRow } from "@/lib/types";
import { Button, Notice, PageHeader, Panel, SectionTitle, Tag, cx } from "@/components/ui";
import { deleteMeal, markEatenOut, recalcMeal } from "../../actions";
import { ConsumptionForm, MoveForm } from "./forms";

export const metadata: Metadata = { title: "Comida" };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  within_tolerance: { label: "Dentro de tolerancia", tone: "ok" },
  with_deviation: { label: "Con desvío", tone: "warn" },
  outside_prescribed_tolerance: { label: "Fuera de la pauta", tone: "warn" },
};
const MACROS = [
  ["kcal", "Energía"],
  ["protein_g", "Proteína"],
  ["carbs_g", "Carbohidratos"],
  ["fat_g", "Grasas"],
] as const;

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data: base } = await ctx.supabase.from("meal_events").select("date").eq("id", id).maybeSingle();
  if (!base) notFound();
  const [event] = (await loadEvents(ctx.supabase, ctx.household.id, base.date as string, base.date as string)).filter((e) => e.id === id);
  if (!event) notFound();

  const partIds = event.lanes.map((l) => l.participantId);
  const [{ data: portionRows }, { data: runs }, { data: myLog }] = await Promise.all([
    partIds.length ? ctx.supabase.from("meal_portions").select("*").in("participant_id", partIds) : Promise.resolve({ data: [] }),
    ctx.supabase.from("calculation_runs").select("outputs, created_at").eq("engine", "portions").eq("inputs->>event_id", id).order("created_at", { ascending: false }).limit(1),
    ctx.supabase.from("consumption_logs").select("*").eq("event_id", id).eq("profile_id", ctx.me.profile_id).maybeSingle(),
  ]);
  const portions = new Map(((portionRows ?? []) as PortionRow[]).map((p) => [p.participant_id, p]));
  const cook = (runs?.[0]?.outputs as { cook?: { lines: CookLine[]; mix: MixPlan | null } } | undefined)?.cook;
  const names = Object.fromEntries(ctx.people.map((p) => [p.profile_id, p.display_name]));

  // Si aún no hay porciones aprobadas, mostrar por qué (sin guardar nada)
  const preview = event.plan_status === "draft" && event.recipe_version_id ? await computeMeal(ctx.supabase, id, { persist: false, names }).catch((e: Error) => ({ problems: [e.message] })) : null;
  const iParticipate = event.lanes.some((l) => l.profileId === ctx.me.profile_id);
  const tone = (pid: string) => personTone(ctx.people, pid);

  return (
    <>
      <PageHeader
        title={event.recipeName}
        lead={`${SLOT_LABEL[event.slot]} del ${longDate(event.date)}. ${MODE_LABEL[event.mode]}${event.batch_id ? ", sale de un lote" : ""}.`}
        actions={
          <>
            <Link href={`/calendario?semana=${isoWeekOf(event.date)}`} className="self-center text-sm text-tinta-suave underline-offset-2 hover:underline">Volver a la semana</Link>
            {event.recipeId ? <Link href={`/recetas/${event.recipeId}`} className="self-center text-sm text-tinta-suave underline-offset-2 hover:underline">Ver receta</Link> : null}
          </>
        }
      />

      {preview && "problems" in preview && preview.problems.length ? (
        <div className="mb-5 space-y-2">
          {preview.problems.map((p, i) => <Notice key={i} tone="warn">{p}</Notice>)}
        </div>
      ) : null}
      {event.plan_status === "eaten_out" ? <div className="mb-5"><Notice>Marcada como comida fuera: no se cocina ni entra a la lista de compras.</Notice></div> : null}

      {/* El plato partido, en grande */}
      <div className={cx("grid gap-0 overflow-hidden rounded-[var(--radius-plato)] border border-avena-fuerte bg-papel", event.lanes.length > 1 && "md:grid-cols-2")}>
        {event.lanes.map((lane) => {
          const p = portions.get(lane.participantId);
          const status = p ? STATUS[p.status] : null;
          return (
            <section key={lane.participantId} className={cx(`tono-${tone(lane.profileId)}`, "border-t-[6px] border-[var(--tono)] p-5", event.lanes.length > 1 && "md:border-l md:border-l-avena md:first:border-l-0")} aria-label={`Porción de ${names[lane.profileId]}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">{names[lane.profileId]}</h2>
                {status ? <Tag tone={status.tone}>{status.label}</Tag> : null}
              </div>
              {lane.lines ? (
                <ul className="cifra space-y-1.5">
                  {lane.lines.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span>{l.kind === "mix" ? "De la preparación" : l.label}{l.kind === "extra" ? <span className="text-tinta-suave"> (solo {names[lane.profileId]})</span> : null}</span>
                      <span className="text-lg font-semibold">
                        {l.units != null ? `${l.units} u` : grams(l.grams)}
                        {STATE_LABEL[l.state] && l.kind !== "mix" ? <span className="ml-1 text-xs font-normal text-tinta-suave">{STATE_LABEL[l.state]}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-tinta-suave">{lane.macros || lane.profileId === ctx.me.profile_id ? "Sin porción aprobada todavía." : `${names[lane.profileId]} no comparte el detalle de su porción.`}</p>
              )}

              {p ? (
                <div className="mt-5">
                  <table className="cifra w-full text-sm">
                    <thead>
                      <tr className="text-left text-tinta-suave">
                        <th className="pb-1 font-normal" />
                        <th className="pb-1 text-right font-normal">Porción</th>
                        <th className="pb-1 text-right font-normal">Presupuesto</th>
                        <th className="pb-1 text-right font-normal">Cumple</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MACROS.map(([k, label]) => {
                        const value = num(p[k]);
                        const target = p.budget ? num((p.budget as Record<string, unknown>)[k]) : NaN;
                        const dev = p.deviations?.[k];
                        return (
                          <tr key={k} className="border-t border-avena">
                            <td className="py-1.5">{label}</td>
                            <td className="py-1.5 text-right font-semibold">{k === "kcal" ? kcal(value, p.confidence) : macro(value, p.confidence)}</td>
                            <td className="py-1.5 text-right text-tinta-suave">{Number.isFinite(target) ? (k === "kcal" ? `${Math.round(target)} kcal` : `${Math.round(target)} g`) : "—"}</td>
                            <td className={cx("py-1.5 text-right", dev && !dev.withinTolerance ? "text-miel" : "text-tinta-suave")}>{Number.isFinite(target) && target > 0 ? `${Math.round((value / target) * 100)} %` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {p.explanations?.length ? (
                    <ul className="mt-3 space-y-1 text-sm text-tinta-suave">
                      {p.explanations.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {cook && event.plan_status !== "eaten_out" ? (
          <Panel>
            <SectionTitle>Para cocinar</SectionTitle>
            {cook.mix && cook.mix.fromBatch ? (
              <p className="mb-3 text-sm text-tinta-suave">La preparación sale del lote; solo se cocinan los acompañamientos.</p>
            ) : null}
            <ul className="cifra space-y-1 text-sm">
              {cook.mix && !cook.mix.fromBatch
                ? cook.mix.cookRawLines.map((l, i) => (
                    <li key={`m${i}`} className="flex justify-between gap-3"><span>{l.label}</span><span className="font-semibold">{grams(l.grams)} <span className="font-normal text-tinta-suave">{STATE_LABEL[l.state]}</span></span></li>
                  ))
                : null}
              {cook.lines.map((l, i) => (
                <li key={`l${i}`} className="flex justify-between gap-3">
                  <span>{l.label}{l.forParticipant ? <span className="text-tinta-suave"> (para {names[l.forParticipant]})</span> : null}</span>
                  <span className="font-semibold">{grams(l.grams)} <span className="font-normal text-tinta-suave">{STATE_LABEL[l.state]}</span></span>
                </li>
              ))}
            </ul>
            {cook.mix ? (
              <p className="mt-4 rounded-xl bg-masa px-3 py-2 text-sm">
                Reparto de la preparación: {cook.mix.allocations.map((a) => `${names[a.participantId]} ${Math.round(a.grams)} g`).join(", ")}
                {cook.mix.leftoverG >= 10 ? `. Sobran ${Math.round(cook.mix.leftoverG)} g para guardar.` : "."}
                {!cook.mix.measured ? " El peso cocido es estimado: si pesas la olla, el reparto queda exacto." : ""}
              </p>
            ) : null}
          </Panel>
        ) : null}

        <Panel>
          <SectionTitle>Acciones</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {event.plan_status !== "eaten_out" ? (
              <form action={recalcMeal}>
                <input type="hidden" name="event_id" value={id} />
                <Button kind="quiet">Recalcular porciones</Button>
              </form>
            ) : null}
            <form action={markEatenOut}>
              <input type="hidden" name="event_id" value={id} />
              {event.plan_status === "eaten_out" ? <input type="hidden" name="restore" value="1" /> : null}
              <Button kind="quiet">{event.plan_status === "eaten_out" ? "Volver a planificarla" : "Comemos fuera"}</Button>
            </form>
            <form action={deleteMeal}>
              <input type="hidden" name="event_id" value={id} />
              <Button kind="danger">Eliminar comida</Button>
            </form>
          </div>
          <MoveForm eventId={id} date={event.date} slot={event.slot} />
        </Panel>

        {iParticipate ? (
          <Panel>
            <SectionTitle>¿Qué comiste?</SectionTitle>
            {myLog ? <p className="mb-3 text-sm text-tinta-suave">Registrado: {consumptionLabel(myLog as ConsumptionRow)}. Puedes corregirlo.</p> : null}
            <ConsumptionForm eventId={id} date={event.date} slot={event.slot} />
            <p className="mt-3 text-xs text-tinta-suave">Lo planificado no cuenta como comido hasta que lo registres. Un desvío no cambia tus próximas comidas.</p>
          </Panel>
        ) : null}
      </div>
    </>
  );
}

function consumptionLabel(c: ConsumptionRow): string {
  const map: Record<ConsumptionRow["kind"], string> = {
    as_planned: "según lo planificado",
    modified_portion: `porción ×${String(num(c.portion_factor)).replace(".", ",")}`,
    different_meal: "otra comida",
    eaten_out: "comida fuera",
    skipped: "omitida",
  };
  return map[c.kind];
}
