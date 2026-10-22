import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/session";
import { loadEvents } from "@/lib/data/week";
import { dayLabel, isoWeekOf, longDate, shiftWeek, todayIn, weekDays, weekRangeLabel } from "@/lib/dates";
import { num, type ConsumptionRow, type GoalRow } from "@/lib/types";
import { Button, Empty, PageHeader, Panel, SectionTitle } from "@/components/ui";
import { WeekChart } from "./week-chart";

export const metadata: Metadata = { title: "Progreso" };

async function addMeasurement(fd: FormData) {
  "use server";
  const ctx = await requireContext();
  const w = fd.get("weight_kg") ? Number(String(fd.get("weight_kg")).replace(",", ".")) : null;
  const waist = fd.get("waist_cm") ? Number(String(fd.get("waist_cm")).replace(",", ".")) : null;
  const date = String(fd.get("measured_on"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (w == null && waist == null)) return;
  await ctx.supabase.from("profile_measurements").upsert({ profile_id: ctx.me.profile_id, measured_on: date, weight_kg: w, waist_cm: waist }, { onConflict: "profile_id,measured_on" });
  if (w != null) await ctx.supabase.from("nutrition_profiles").update({ weight_kg: w }).eq("id", ctx.me.profile_id);
  revalidatePath("/progreso");
}

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const today = todayIn(ctx.household.timezone);
  const week = sp.semana && /^\d{4}-W\d{2}$/.test(sp.semana) ? sp.semana : isoWeekOf(today);
  const days = weekDays(week);
  const pid = ctx.active.profile_id;
  const [events, { data: logs }, { data: goal }, { data: measurements }] = await Promise.all([
    loadEvents(ctx.supabase, ctx.household.id, days[0]!, days[6]!),
    ctx.supabase.from("consumption_logs").select("*").eq("profile_id", pid).gte("date", days[0]!).lte("date", days[6]!),
    ctx.supabase.from("nutrition_goals").select("*").eq("profile_id", pid).is("valid_to", null).maybeSingle(),
    ctx.supabase.from("profile_measurements").select("measured_on, weight_kg, waist_cm").eq("profile_id", pid).order("measured_on", { ascending: false }).limit(12),
  ]);
  const g = goal as GoalRow | null;
  const visible = ctx.active.is_me || ctx.active.my_view_level === "full";
  if (!visible) {
    return (
      <>
        <PageHeader title="Progreso" />
        <Empty title={`${ctx.active.display_name} no comparte su progreso`}>Puede cambiarlo en su Configuración.</Empty>
      </>
    );
  }
  const consumption = (logs ?? []) as ConsumptionRow[];
  const data = days.map((d) => ({
    day: dayLabel(d),
    planificado: events.filter((e) => e.date === d && e.plan_status === "approved").reduce((a, e) => a + (e.lanes.find((l) => l.profileId === pid)?.macros?.kcal ?? 0), 0),
    comido: consumption.filter((c) => c.date === d).reduce((a, c) => a + num(c.kcal ?? 0), 0),
  }));
  const plannedMeals = events.filter((e) => e.plan_status === "approved" && e.lanes.some((l) => l.profileId === pid) && e.date <= today);
  const logged = plannedMeals.filter((e) => consumption.some((c) => c.event_id === e.id)).length;
  const asPlanned = consumption.filter((c) => c.kind === "as_planned").length;
  const daysWithLogs = new Set(consumption.map((c) => c.date)).size;
  const avgEaten = daysWithLogs ? data.reduce((a, x) => a + x.comido, 0) / daysWithLogs : 0;

  return (
    <>
      <PageHeader title="Progreso" lead={`Semana del ${weekRangeLabel(week)}. Planificado y registrado se muestran por separado: lo planificado no cuenta como comido.`} />
      <div className="mb-4 flex items-center gap-1">
        <Link href={`/progreso?semana=${shiftWeek(week, -1)}`} className="rounded-full border border-avena px-3 py-1.5 text-sm" aria-label="Semana anterior">‹</Link>
        <Link href={`/progreso?semana=${shiftWeek(week, 1)}`} className="rounded-full border border-avena px-3 py-1.5 text-sm" aria-label="Semana siguiente">›</Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <SectionTitle>Energía por día</SectionTitle>
          <WeekChart data={data} target={g ? num(g.kcal) : null} />
          <div className="mt-2 flex gap-4 text-sm text-tinta-suave">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-avena-fuerte" />Planificado</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-salvia" />Registrado</span>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel>
            <SectionTitle>Cumplimiento de la planificación</SectionTitle>
            <dl className="cifra grid grid-cols-2 gap-4">
              <div><dt className="text-sm text-tinta-suave">Comidas registradas</dt><dd className="font-display text-3xl font-semibold">{logged}<span className="text-base font-normal text-tinta-suave"> / {plannedMeals.length}</span></dd></div>
              <div><dt className="text-sm text-tinta-suave">Según lo planificado</dt><dd className="font-display text-3xl font-semibold">{asPlanned}</dd></div>
              <div className="col-span-2"><dt className="text-sm text-tinta-suave">Promedio registrado en días con registro</dt><dd className="text-lg font-semibold">{daysWithLogs ? `${Math.round(avgEaten / 10) * 10} kcal${g ? ` (meta ${Math.round(num(g.kcal) / 10) * 10})` : ""}` : "—"}</dd></div>
            </dl>
          </Panel>
          <Panel>
            <SectionTitle>Mediciones</SectionTitle>
            {ctx.active.is_me ? (
              <form action={addMeasurement} className="mb-4 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <label className="text-xs text-tinta-suave">Fecha<input name="measured_on" type="date" defaultValue={today} className="campo mt-1" /></label>
                <label className="text-xs text-tinta-suave">Peso (kg)<input name="weight_kg" inputMode="decimal" className="campo cifra mt-1" /></label>
                <label className="text-xs text-tinta-suave">Cintura (cm)<input name="waist_cm" inputMode="decimal" className="campo cifra mt-1" /></label>
                <Button kind="quiet">Guardar</Button>
              </form>
            ) : null}
            {(measurements ?? []).length ? (
              <ul className="cifra divide-y divide-avena text-sm">
                {(measurements ?? []).map((m) => (
                  <li key={m.measured_on as string} className="flex justify-between py-1.5">
                    <span>{longDate(m.measured_on as string)}</span>
                    <span>{m.weight_kg != null ? `${num(m.weight_kg)} kg` : ""}{m.waist_cm != null ? `  ${num(m.waist_cm)} cm` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-tinta-suave">Sin mediciones todavía.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
