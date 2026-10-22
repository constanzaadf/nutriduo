import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, personTone } from "@/lib/session";
import { loadEvents, SLOT_LABEL, SLOT_ORDER } from "@/lib/data/week";
import { dayLabel, isoWeekOf, longDate, shiftWeek, todayIn, weekDays, weekRangeLabel } from "@/lib/dates";
import { MealCard } from "@/components/meal-card";
import { Button, LinkButton, PageHeader, PersonDot, cx } from "@/components/ui";
import { copyDay } from "./actions";

export const metadata: Metadata = { title: "Calendario" };

type View = "yo" | "pareja" | "hogar";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ semana?: string; vista?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const today = todayIn(ctx.household.timezone);
  const week = sp.semana && /^\d{4}-W\d{2}$/.test(sp.semana) ? sp.semana : isoWeekOf(today);
  const view: View = sp.vista === "yo" || sp.vista === "pareja" ? sp.vista : "hogar";
  const days = weekDays(week);
  const all = await loadEvents(ctx.supabase, ctx.household.id, days[0]!, days[6]!);
  const focus = view === "yo" ? ctx.active.profile_id : view === "pareja" ? ctx.people.find((p) => p.profile_id !== ctx.active.profile_id)?.profile_id : null;
  const events = focus ? all.filter((e) => e.lanes.some((l) => l.profileId === focus)) : all;
  const slots = SLOT_ORDER.filter((s) => s !== "extra" || events.some((e) => e.slot === "extra"));

  const href = (patch: { semana?: string; vista?: View }) => `/calendario?semana=${patch.semana ?? week}&vista=${patch.vista ?? view}`;
  const at = (d: string, s: string) => events.filter((e) => e.date === d && e.slot === s);

  // Energía planificada por persona y día (solo lo visible)
  const planned = (d: string, pid: string) =>
    events.filter((e) => e.date === d).reduce((acc, e) => acc + (e.lanes.find((l) => l.profileId === pid)?.macros?.kcal ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Calendario"
        lead={`Semana del ${weekRangeLabel(week)}.`}
        actions={<LinkButton href={`/calendario/nuevo?fecha=${days.includes(today) ? today : days[0]}`}>Agregar comida</LinkButton>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={href({ semana: shiftWeek(week, -1) })} className="rounded-full border border-avena px-3 py-1.5 text-sm hover:border-tinta-suave" aria-label="Semana anterior">‹</Link>
          <Link href={href({ semana: isoWeekOf(today) })} className="rounded-full border border-avena px-3 py-1.5 text-sm hover:border-tinta-suave">Esta semana</Link>
          <Link href={href({ semana: shiftWeek(week, 1) })} className="rounded-full border border-avena px-3 py-1.5 text-sm hover:border-tinta-suave" aria-label="Semana siguiente">›</Link>
        </div>
        <div role="tablist" aria-label="Vista" className="flex gap-1 rounded-full bg-avena/40 p-1 text-sm">
          {(
            [
              ["yo", ctx.active.is_me ? "Mi calendario" : `Calendario de ${ctx.active.display_name}`],
              ["pareja", ctx.partner ? (ctx.active.is_me ? `De ${ctx.partner.display_name}` : "El mío") : "Pareja"],
              ["hogar", "Hogar"],
            ] as [View, string][]
          ).map(([v, l]) => (
            <Link key={v} role="tab" aria-selected={view === v} href={href({ vista: v })} className={cx("rounded-full px-3 py-1", view === v ? "bg-papel font-semibold" : "text-tinta-suave")}>
              {l}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm text-tinta-suave">
        {ctx.people.map((p) => <PersonDot key={p.profile_id} tone={personTone(ctx.people, p.profile_id)} name={p.display_name} />)}
        <span>Borde continuo: compartida. Punteado: individual.</span>
      </div>

      {/* Escritorio: grilla de 7 días */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[60rem] table-fixed border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-24" />
              {days.map((d) => (
                <th key={d} className={cx("rounded-xl px-2 py-1.5 text-left text-sm font-semibold", d === today && "bg-salvia-claro")}>
                  {dayLabel(d)}
                  <div className="cifra mt-0.5 space-y-0.5 text-[0.7rem] font-normal text-tinta-suave">
                    {ctx.people.map((p) => {
                      const k = planned(d, p.profile_id);
                      return k > 0 ? <div key={p.profile_id} className={`tono-${personTone(ctx.people, p.profile_id)} flex items-center gap-1`}><span className="h-1.5 w-1.5 rounded-full bg-[var(--tono)]" />{Math.round(k / 10) * 10} kcal</div> : null;
                    })}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s}>
                <th scope="row" className="pr-2 text-left align-top text-sm font-medium text-tinta-suave">{SLOT_LABEL[s]}</th>
                {days.map((d) => {
                  const list = at(d, s);
                  return (
                    <td key={d} className="align-top">
                      <div className="space-y-1.5">
                        {list.map((e) => <MealCard key={e.id} event={e} people={ctx.people} compact />)}
                        {list.length === 0 || (list.every((e) => e.mode === "B") && list.length < ctx.people.length) ? (
                          <Link href={`/calendario/nuevo?fecha=${d}&slot=${s}`} className="block rounded-xl border border-dashed border-avena px-2 py-2 text-center text-xs text-tinta-suave/70 hover:border-avena-fuerte hover:text-tinta" aria-label={`Agregar ${SLOT_LABEL[s]} el ${longDate(d)}`}>
                            +
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Móvil: un día tras otro */}
      <div className="space-y-6 lg:hidden">
        {days.map((d) => (
          <section key={d} aria-labelledby={`d-${d}`}>
            <h2 id={`d-${d}`} className={cx("mb-2 text-lg font-semibold", d === today && "text-salvia-oscuro")}>
              {longDate(d)}
            </h2>
            <div className="space-y-2">
              {slots.map((s) => {
                const list = at(d, s);
                if (list.length === 0) return null;
                return (
                  <div key={s} className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <p className="pt-2 text-sm text-tinta-suave">{SLOT_LABEL[s]}</p>
                    <div className="space-y-2">{list.map((e) => <MealCard key={e.id} event={e} people={ctx.people} />)}</div>
                  </div>
                );
              })}
              <Link href={`/calendario/nuevo?fecha=${d}`} className="block rounded-xl border border-dashed border-avena px-3 py-2 text-sm text-tinta-suave">
                Agregar comida
              </Link>
            </div>
          </section>
        ))}
      </div>

      <form action={copyDay} className="mt-8 flex flex-wrap items-end gap-2 rounded-2xl border border-avena bg-papel p-4">
        <label className="text-sm">
          <span className="etiqueta">Copiar las comidas del</span>
          <select name="from" className="campo">{days.map((d) => <option key={d} value={d}>{longDate(d)}</option>)}</select>
        </label>
        <label className="text-sm">
          <span className="etiqueta">al</span>
          <input type="date" name="to" className="campo" required />
        </label>
        <Button kind="quiet">Copiar día</Button>
        <p className="w-full text-xs text-tinta-suave">Se copian recetas y modalidades; las porciones se recalculan con las metas del día de destino.</p>
      </form>
    </>
  );
}
