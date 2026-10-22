import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/session";
import { loadEvents, SLOT_LABEL, SLOT_ORDER } from "@/lib/data/week";
import { isoWeekOf, longDate, todayIn, weekDays, weekdayIndex } from "@/lib/dates";
import { num, type ConsumptionRow, type GoalRow } from "@/lib/types";
import { MealCard } from "@/components/meal-card";
import { Empty, LinkButton, MeterRow, Panel, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Inicio" };

export default async function DashboardPage() {
  const ctx = await requireContext();
  const today = todayIn(ctx.household.timezone);
  const week = isoWeekOf(today);
  const days = weekDays(week);
  const pid = ctx.active.profile_id;
  const db = ctx.supabase;

  const [events, { data: goalData }, { data: logs }, { data: batches }, { data: list }] = await Promise.all([
    loadEvents(db, ctx.household.id, days[0]!, days[6]!),
    db.from("nutrition_goals").select("*").eq("profile_id", pid).is("valid_to", null).maybeSingle(),
    db.from("consumption_logs").select("*").eq("profile_id", pid).gte("date", days[0]!).lte("date", days[6]!),
    db.from("cooking_batches").select("id, planned_for, status, recipe_versions(name)").eq("status", "planned").gte("planned_for", today).order("planned_for").limit(1),
    db.from("shopping_lists").select("id, shopping_list_items(checked, buy_g, manual)").eq("household_id", ctx.household.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const goal = goalData as GoalRow | null;
  const { data: slotRows } = goal ? await db.from("meal_slot_targets").select("slot").eq("goal_id", goal.id) : { data: null };
  const slotsPerDay = slotRows?.length || 4;

  const mine = events.filter((e) => e.lanes.some((l) => l.profileId === pid));
  const todays = mine.filter((e) => e.date === today).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const lane = (e: (typeof events)[number]) => e.lanes.find((l) => l.profileId === pid);
  const sum = (list: typeof events) =>
    list.reduce(
      (acc, e) => {
        const m = lane(e)?.macros;
        if (!m || e.plan_status !== "approved") return acc;
        return { kcal: acc.kcal + m.kcal, protein_g: acc.protein_g + m.protein_g, carbs_g: acc.carbs_g + m.carbs_g, fat_g: acc.fat_g + m.fat_g, fiber_g: acc.fiber_g + m.fiber_g, estimated: acc.estimated || m.confidence === "estimated" };
      },
      { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, estimated: false },
    );
  const plannedToday = sum(todays);
  const consumed = ((logs ?? []) as ConsumptionRow[]).filter((l) => l.date === today);
  const eaten = consumed.reduce(
    (acc, l) => ({ kcal: acc.kcal + num(l.kcal ?? 0), protein_g: acc.protein_g + num(l.protein_g ?? 0), carbs_g: acc.carbs_g + num(l.carbs_g ?? 0), fat_g: acc.fat_g + num(l.fat_g ?? 0), estimated: acc.estimated || l.confidence === "estimated" }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, estimated: false },
  );
  const dayTarget = goal ? (goal.by_weekday?.[weekdayIndex(today)] ?? goal) : null;
  const plannedSlots = new Set(mine.filter((e) => e.plan_status !== "cancelled").map((e) => `${e.date}|${e.slot}`)).size;
  const pending = ((list as { shopping_list_items: { checked: boolean; buy_g: number; manual: boolean }[] } | null)?.shopping_list_items ?? []).filter((i) => !i.checked && (num(i.buy_g) > 0 || i.manual)).length;
  const nextBatch = (batches ?? [])[0] as unknown as { id: string; planned_for: string; recipe_versions: { name: string } | null } | undefined;
  const who = ctx.active.is_me ? "" : ` de ${ctx.active.display_name}`;

  return (
    <>
      <header className="mb-6">
        <p className="text-tinta-suave">{longDate(today)}</p>
        <h1 className="text-[2rem] font-semibold sm:text-[2.4rem]">{ctx.active.is_me ? `Hola, ${ctx.me.display_name}` : `Día de ${ctx.active.display_name}`}</h1>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <SectionTitle aside={<Link href="/progreso" className="text-sm text-tinta-suave underline-offset-2 hover:underline">Semana</Link>}>Hoy{who}</SectionTitle>
          {dayTarget ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2.5">
                <p className="text-sm font-semibold">Planificado</p>
                <MeterRow label="Energía" value={plannedToday.kcal} target={num(dayTarget.kcal)} unit="kcal" estimated={plannedToday.estimated} />
                <MeterRow label="Proteína" value={plannedToday.protein_g} target={num(dayTarget.protein_g)} estimated={plannedToday.estimated} />
                <MeterRow label="Carbos" value={plannedToday.carbs_g} target={num(dayTarget.carbs_g)} estimated={plannedToday.estimated} />
                <MeterRow label="Grasas" value={plannedToday.fat_g} target={num(dayTarget.fat_g)} estimated={plannedToday.estimated} />
              </div>
              <div className="space-y-2.5">
                <p className="text-sm font-semibold">Registrado como comido</p>
                {consumed.length ? (
                  <>
                    <MeterRow label="Energía" value={eaten.kcal} target={num(dayTarget.kcal)} unit="kcal" estimated={eaten.estimated} />
                    <MeterRow label="Proteína" value={eaten.protein_g} target={num(dayTarget.protein_g)} estimated={eaten.estimated} />
                    <MeterRow label="Carbos" value={eaten.carbs_g} target={num(dayTarget.carbs_g)} estimated={eaten.estimated} />
                    <MeterRow label="Grasas" value={eaten.fat_g} target={num(dayTarget.fat_g)} estimated={eaten.estimated} />
                  </>
                ) : (
                  <p className="text-sm text-tinta-suave">Nada registrado todavía. Al terminar una comida, ábrela y marca qué comiste.</p>
                )}
              </div>
            </div>
          ) : ctx.active.is_me ? (
            <Empty title="Falta tu meta" action={<LinkButton href="/config">Configurar meta</LinkButton>}>Sin meta, el motor no puede calcular tus porciones.</Empty>
          ) : (
            <p className="text-sm text-tinta-suave">{ctx.active.display_name} no comparte sus metas.</p>
          )}
        </Panel>

        <Panel>
          <SectionTitle>Esta semana</SectionTitle>
          <dl className="cifra grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-tinta-suave">Comidas planificadas</dt>
              <dd className="font-display text-3xl font-semibold">{plannedSlots}<span className="text-base font-normal text-tinta-suave"> / {slotsPerDay * 7}</span></dd>
            </div>
            <div>
              <dt className="text-sm text-tinta-suave">Por comprar</dt>
              <dd className="font-display text-3xl font-semibold">{pending}<span className="text-base font-normal text-tinta-suave"> ítems</span></dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/calendario" kind="quiet">Ver calendario</LinkButton>
            <LinkButton href="/compras" kind="quiet">Ir a compras</LinkButton>
          </div>
          {nextBatch ? (
            <p className="mt-4 rounded-xl bg-masa px-3 py-2 text-sm">
              Próxima preparación: <Link href="/preparaciones" className="font-semibold underline-offset-2 hover:underline">{nextBatch.recipe_versions?.name}</Link>, {longDate(nextBatch.planned_for)}.
            </p>
          ) : null}
        </Panel>
      </div>

      <section className="mt-6">
        <SectionTitle aside={<Link href={`/calendario/nuevo?fecha=${today}`} className="text-sm text-salvia-oscuro underline-offset-2 hover:underline">Agregar</Link>}>Comidas de hoy</SectionTitle>
        {todays.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {todays.map((e) => (
              <li key={e.id}>
                <p className="mb-1 text-sm text-tinta-suave">{SLOT_LABEL[e.slot]}</p>
                <MealCard event={e} people={ctx.people} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nada planificado para hoy" action={<LinkButton href={`/calendario/nuevo?fecha=${today}`}>Planificar una comida</LinkButton>} />
        )}
      </section>
    </>
  );
}
