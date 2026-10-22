import Link from "next/link";
import type { WeekEvent } from "@/lib/data/week";
import { laneSummary } from "@/lib/data/week";
import type { Person } from "@/lib/types";
import { cx } from "./ui";

/**
 * El "plato partido": una comida compartida es UNA tarjeta con una franja por
 * persona, cada una con su porción. Una comida individual es una tarjeta
 * punteada en el tono de su dueño.
 */
export function MealCard({ event, people, compact = false }: { event: WeekEvent; people: Person[]; compact?: boolean }) {
  const shared = event.mode !== "B";
  const tone = (pid: string) => (people.findIndex((p) => p.profile_id === pid) === 1 ? 1 : 0);
  const name = (pid: string) => people.find((p) => p.profile_id === pid)?.display_name ?? "—";
  const out = event.plan_status === "eaten_out";
  const draft = event.plan_status === "draft";
  const single = event.lanes[0];

  return (
    <Link
      href={`/calendario/evento/${event.id}`}
      className={cx(
        "group block overflow-hidden rounded-2xl bg-papel text-left transition-colors",
        shared ? "border border-avena-fuerte hover:border-tinta-suave" : cx("border border-dashed", single ? `tono-${tone(single.profileId)} border-[var(--tono)]` : "border-avena-fuerte"),
        out && "opacity-60",
      )}
      aria-label={`${event.recipeName}, ${shared ? "compartida" : `individual de ${single ? name(single.profileId) : ""}`}`}
    >
      <div className={cx("px-3 pt-2", compact ? "pb-1" : "pb-1.5")}>
        <p className={cx("font-medium leading-snug", compact ? "text-[0.82rem]" : "text-[0.95rem]")}>
          {event.batch_id ? <span aria-label="Desde un lote" title="Sale de un lote">◐ </span> : null}
          {event.recipeName}
        </p>
        {draft ? <p className="text-[0.7rem] text-miel">Sin porciones aprobadas</p> : null}
        {out ? <p className="text-[0.7rem] text-tinta-suave">Comen fuera</p> : null}
      </div>
      {!out ? (
        <div className={cx("grid", shared && event.lanes.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {event.lanes.map((lane) => (
            <div key={lane.participantId} className={cx(`tono-${tone(lane.profileId)}`, "border-t-[3px] border-[var(--tono)] bg-[var(--tono-claro)]/60 px-3 py-1.5")}>
              <p className="truncate text-[0.68rem] font-semibold text-tinta-suave">{name(lane.profileId)}</p>
              <p className={cx("cifra truncate", compact ? "text-[0.72rem]" : "text-[0.8rem]")}>{lane.lines ? laneSummary(lane.lines) : lane.macros === null ? "Privado" : "—"}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
