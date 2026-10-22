"use client";

import { useActionState, useState } from "react";
import { Submit } from "@/components/submit";
import { Notice } from "@/components/ui";
import { logConsumption, moveMeal, type MealFormState } from "../../actions";

export function MoveForm({ eventId, date, slot }: { eventId: string; date: string; slot: string }) {
  const [state, action] = useActionState<MealFormState, FormData>(moveMeal, null);
  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-2">
      <input type="hidden" name="event_id" value={eventId} />
      <label className="text-sm">
        <span className="etiqueta">Mover al</span>
        <input type="date" name="date" defaultValue={date} className="campo" />
      </label>
      <label className="text-sm">
        <span className="etiqueta">Tiempo</span>
        <select name="slot" defaultValue={slot} className="campo">
          <option value="breakfast">Desayuno</option>
          <option value="snack_am">Snack mañana</option>
          <option value="lunch">Almuerzo</option>
          <option value="snack_pm">Snack tarde</option>
          <option value="dinner">Cena</option>
          <option value="extra">Adicional</option>
        </select>
      </label>
      <Submit kind="quiet" pendingLabel="Moviendo…">Mover</Submit>
      {state ? <div className="w-full"><Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice></div> : null}
    </form>
  );
}

export function ConsumptionForm({ eventId, date, slot }: { eventId: string; date: string; slot: string }) {
  const [state, action] = useActionState<MealFormState, FormData>(logConsumption, null);
  const [kind, setKind] = useState("as_planned");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="slot" value={slot} />
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {[
          ["as_planned", "Lo planificado"],
          ["modified_portion", "Otra cantidad"],
          ["different_meal", "Otra comida"],
          ["eaten_out", "Comí fuera"],
          ["skipped", "No comí"],
        ].map(([v, l]) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 rounded-xl border border-avena px-3 py-2 has-[:checked]:border-salvia has-[:checked]:bg-salvia-claro/60">
            <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v!)} className="accent-[var(--color-salvia)]" />
            {l}
          </label>
        ))}
      </div>
      {kind === "modified_portion" ? (
        <label className="block text-sm">
          <span className="etiqueta">¿Cuánto de tu porción?</span>
          <select name="factor" className="campo" defaultValue="0.75">
            <option value="0.5">La mitad</option>
            <option value="0.75">Tres cuartos</option>
            <option value="1.25">Un cuarto más</option>
            <option value="1.5">Una vez y media</option>
          </select>
        </label>
      ) : null}
      {kind === "different_meal" || kind === "eaten_out" ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
          <input name="free_text" className="campo" placeholder="Qué comiste" />
          <input name="kcal" inputMode="numeric" className="campo cifra" placeholder="kcal aprox." />
        </div>
      ) : null}
      <Submit kind="quiet">Registrar</Submit>
      {state ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
    </form>
  );
}
