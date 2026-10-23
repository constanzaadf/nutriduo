import type { Metadata } from "next";
import Link from "next/link";
import { SLOT_KIND, type ProposedEvent } from "@nutriduo/menu-engine";
import { requireContext } from "@/lib/session";
import { parseWeekMenuOptions, proposeWeekMenu } from "@/lib/engines/week-menu";
import { SLOT_LABEL } from "@/lib/data/week";
import { FOOD_STATE_LABEL } from "@/lib/data/labels";
import { isoWeekOf, longDate, shiftWeek, todayIn, weekRangeLabel } from "@/lib/dates";
import { grams, kcal, macro } from "@/lib/format";
import { Button, Empty, LinkButton, Notice, PageHeader, Panel, SectionTitle, Tag, cx } from "@/components/ui";
import { applyWeekMenu } from "./actions";

export const metadata: Metadata = { title: "Menú de la semana" };
// Aplicar calcula y aprueba unas 20 comidas: necesita más que el tope por defecto.
export const maxDuration = 60;

type SP = Record<string, string | undefined>;

export default async function WeekMenuPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const today = todayIn(ctx.household.timezone);
  // Por defecto, la semana que viene: el domingo de cocina es antes de que empiece.
  const o = parseWeekMenuOptions(sp, shiftWeek(isoWeekOf(today), 1));
  const r = await proposeWeekMenu(ctx, o);
  const p = r.proposal;
  const me = ctx.me.profile_id;
  const name = (id: string) => r.ingredients.get(id)?.name ?? "Ingrediente";
  const people = Object.fromEntries(ctx.people.map((x) => [x.profile_id, x.is_me ? "tú" : x.display_name]));

  const qs = (patch: SP) => {
    const next = { semana: o.week, variante: String(o.seed), ollas: String(o.pots), cenas: o.weekdayDinner === "fresh" ? "dia" : "olla", desayuno: o.breakfast ? "si" : "no", ...patch };
    return `/calendario/semana?${new URLSearchParams(Object.entries(next).filter(([, v]) => v != null) as [string, string][]).toString()}`;
  };
  const chip = (active: boolean) => cx("rounded-full border px-3 py-1", active ? "border-salvia bg-salvia-claro" : "border-avena");
  const dates = [...new Set(p.events.map((e) => e.date).concat(p.unfilled.map((u) => u.date)))].sort();
  const cookPast = r.cookDate < today;

  return (
    <>
      <PageHeader
        title="Menú de la semana"
        lead={`Semana del ${weekRangeLabel(o.week)}, cocinando el ${longDate(r.cookDate)}. Nada se guarda hasta que lo apliques.`}
        actions={<LinkButton href={`/calendario?semana=${o.week}`} kind="quiet">Volver al calendario</LinkButton>}
      />

      {sp.aviso === "cambio" ? <div className="mb-4"><Notice tone="warn">Algo cambió desde que viste la propuesta (una meta, una receta o el calendario). Revisa esta versión y vuelve a aplicar.</Notice></div> : null}
      {sp.aviso === "ocupado" ? <div className="mb-4"><Notice tone="warn">Alguien agregó una comida en uno de estos tiempos mientras revisabas. No se aplicó nada; esta propuesta ya lo considera.</Notice></div> : null}
      {sp.aviso === "error" ? <div className="mb-4"><Notice tone="error">No se pudo aplicar el menú. No quedó nada a medias; intenta de nuevo.</Notice></div> : null}

      <Panel className="mb-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
          <div className="flex items-center gap-1">
            <Link href={qs({ semana: shiftWeek(o.week, -1), variante: "0" })} className="rounded-full border border-avena px-3 py-1.5 hover:border-tinta-suave" aria-label="Semana anterior">‹</Link>
            <span className="px-2 font-medium">{weekRangeLabel(o.week)}</span>
            <Link href={qs({ semana: shiftWeek(o.week, 1), variante: "0" })} className="rounded-full border border-avena px-3 py-1.5 hover:border-tinta-suave" aria-label="Semana siguiente">›</Link>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-tinta-suave">Ollas:</span>
            {[2, 3, 4].map((n) => <Link key={n} href={qs({ ollas: String(n), variante: "0" })} className={chip(o.pots === n)}>{n}</Link>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-tinta-suave">Cenas de semana:</span>
            <Link href={qs({ cenas: "olla", variante: "0" })} className={chip(o.weekdayDinner === "batch")}>de la olla</Link>
            <Link href={qs({ cenas: "dia", variante: "0" })} className={chip(o.weekdayDinner === "fresh")}>rápidas en el día</Link>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-tinta-suave">Desayunos:</span>
            <Link href={qs({ desayuno: "si", variante: "0" })} className={chip(o.breakfast)}>planificar</Link>
            <Link href={qs({ desayuno: "no", variante: "0" })} className={chip(!o.breakfast)}>no</Link>
          </div>
        </div>
      </Panel>

      {r.peopleWithoutGoal.length ? (
        <div className="mb-4">
          <Notice tone="warn">
            {r.peopleWithoutGoal.join(" y ")} no {r.peopleWithoutGoal.length > 1 ? "tienen" : "tiene"} meta vigente, así que no {r.peopleWithoutGoal.length > 1 ? "entran" : "entra"} en el menú.
            Se configura en <Link href="/config" className="underline">Configuración → Metas</Link>.
          </Notice>
        </div>
      ) : null}
      {r.skippedOccupied.length ? (
        <div className="mb-4"><Notice>{r.skippedOccupied.length} tiempo(s) ya tienen comida en el calendario y no se tocan.</Notice></div>
      ) : null}
      {cookPast ? (
        <div className="mb-4"><Notice tone="warn">El domingo de cocina de esta semana ({longDate(r.cookDate)}) ya pasó. Puedes aplicarlo igual y cocinar apenas puedas, o planificar la semana siguiente.</Notice></div>
      ) : null}

      {p.events.length === 0 ? (
        <Empty title="No hay nada que proponer">
          {r.participants.length === 0 ? "Primero hace falta al menos una meta vigente." : "Todos los tiempos de esta semana ya tienen comida, o el recetario no tiene recetas que sirvan."}
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-5">
            <Panel>
              <SectionTitle>Para cocinar el {longDate(r.cookDate)}</SectionTitle>
              {p.batches.length === 0 ? (
                <p className="text-sm text-tinta-suave">Esta semana no hay ollas: todo se cocina en el día.</p>
              ) : (
                <ol className="space-y-5">
                  {p.batches.map((b, i) => (
                    <li key={b.key}>
                      <p className="font-semibold">{i + 1}. {b.name}</p>
                      <p className="cifra text-sm text-tinta-suave">
                        {grams(b.cookedTotalG)} cocido para {b.meals} comidas (≈ {String(b.servingsEquivalent).replace(".", ",")} porciones de la receta)
                      </p>
                      <ul className="cifra mt-2 grid grid-cols-[1fr_auto] gap-x-3 text-sm">
                        {b.rawLines.map((l) => (
                          <li key={l.ingredientId} className="contents">
                            <span>{name(l.ingredientId)}</span>
                            <span className="text-right">{grams(l.grams)} {l.state === "raw" ? "" : FOOD_STATE_LABEL[l.state]}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-sm">
                        Refrigerar {grams(b.fridgeG)}
                        {b.freezerG > 0 ? <>; <strong>congelar {grams(b.freezerG)}</strong> en porciones</> : null}.
                      </p>
                      {b.sides.length ? (
                        <p className="mt-1 text-sm text-tinta-suave">
                          Acompañamientos de esas comidas (en el día o también el domingo): {b.sides.map((x) => `${name(x.ingredientId)} ${grams(x.grams)} ${FOOD_STATE_LABEL[x.state]}`).join(", ")}.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-4 text-xs text-tinta-suave">
                Las cantidades suman las porciones de cada uno más un 8 % de margen. Al cocinar, pesa la olla en Preparaciones y las porciones se recalculan con el peso real.
              </p>
            </Panel>

            {p.notes.length ? (
              <Panel>
                <SectionTitle>A tener en cuenta</SectionTitle>
                <ul className="list-disc space-y-1 pl-5 text-sm">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </Panel>
            ) : null}

            <Panel>
              <form action={applyWeekMenu} className="space-y-3">
                <input type="hidden" name="semana" value={o.week} />
                <input type="hidden" name="variante" value={o.seed} />
                <input type="hidden" name="ollas" value={o.pots} />
                <input type="hidden" name="cenas" value={o.weekdayDinner === "fresh" ? "dia" : "olla"} />
                <input type="hidden" name="desayuno" value={o.breakfast ? "si" : "no"} />
                <input type="hidden" name="hash" value={p.trace.inputHash} />
                <Button className="w-full">Aplicar al calendario</Button>
                <LinkButton href={qs({ variante: String(o.seed + 1) })} kind="quiet" className="w-full">Otra propuesta</LinkButton>
              </form>
              <p className="mt-3 text-xs text-tinta-suave">
                Aplicar crea {p.events.length} comidas y {p.batches.length} olla(s), calcula las porciones de cada uno y las deja en la lista de compras de la semana.
              </p>
            </Panel>
          </div>

          <div className="space-y-3">
            {dates.map((d) => {
              const evs = p.events.filter((e) => e.date === d);
              const miss = p.unfilled.filter((u) => u.date === d);
              const day = p.days.find((x) => x.date === d && x.participantId === me);
              return (
                <Panel key={d} className="p-0 sm:p-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-avena px-5 py-3">
                    <h2 className="font-semibold capitalize">{longDate(d)}</h2>
                    {day ? (
                      <span className="cifra text-sm text-tinta-suave">
                        Tú: {kcal(day.planned.kcal)}
                        {day.budget ? ` de ${kcal(day.budget.kcal)}` : ""}, {macro(day.planned.protein_g)} proteína
                        {day.budget ? ` de ${macro(day.budget.protein_g)}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <ul className="divide-y divide-avena">
                    {evs.map((e) => <EventRow key={`${e.date}|${e.slot}`} e={e} me={me} people={people} ingredientName={name} />)}
                    {miss.map((u) => (
                      <li key={u.slot} className="px-5 py-3 text-sm">
                        <span className="font-medium">{SLOT_LABEL[u.slot]}:</span> <span className="text-tinta-suave">sin propuesta, {u.reason}.</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
            <p className="text-xs text-tinta-suave">
              Ves tus porciones; las de {ctx.partner?.display_name ?? "tu pareja"} se calculan con su meta y quedan en su calendario según lo que comparta contigo.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function EventRow({ e, me, people, ingredientName }: { e: ProposedEvent; me: string; people: Record<string, string>; ingredientName: (id: string) => string }) {
  const mine = e.portions.find((x) => x.participantId === me);
  const main = SLOT_KIND[e.slot] === "main";
  const skips = e.portions.filter((x) => x.skipSides.length).map((x) => `${people[x.participantId] ?? "alguien"} sin ${x.skipSides.map(ingredientName).join(", ")}`);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm text-tinta-suave">{SLOT_LABEL[e.slot]}</p>
        <Link href={`/recetas/${e.recipeId}`} className={cx("font-medium hover:underline", main && "text-[1.05rem]")}>{e.name}</Link>
        {e.why.length ? <p className="text-sm text-tinta-suave">{e.why.join(" ")}</p> : null}
        {skips.length ? <p className="text-sm text-tinta-suave">Acompañamiento: {skips.join("; ")} (por restricción).</p> : null}
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        {e.source === "batch" ? <Tag tone={e.storage === "freezer" ? "warn" : "ok"}>{e.storage === "freezer" ? "Olla · congelada" : "Olla · refrigerada"}</Tag> : <Tag>En el día</Tag>}
        {mine ? (
          <span className="cifra text-sm">
            {kcal(mine.nutrients.kcal)}, {macro(mine.nutrients.protein_g)} P{mine.mixG ? ` · ${grams(mine.mixG)}` : ""}
          </span>
        ) : null}
      </div>
    </li>
  );
}
