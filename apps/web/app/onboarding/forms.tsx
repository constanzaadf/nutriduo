"use client";

import { useActionState } from "react";
import { Submit } from "@/components/submit";
import { Notice, Panel } from "@/components/ui";
import { createHousehold, joinHousehold, type OnboardingState } from "./actions";

export function OnboardingForms() {
  const [createState, create] = useActionState<OnboardingState, FormData>(createHousehold, null);
  const [joinState, join] = useActionState<OnboardingState, FormData>(joinHousehold, null);
  return (
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Panel>
        <h2 className="text-xl font-semibold">Crear un hogar</h2>
        <form action={create} className="mt-4 space-y-3">
          <div>
            <label className="etiqueta" htmlFor="household">Nombre del hogar</label>
            <input id="household" name="household" className="campo" placeholder="Casa Ñuñoa" required />
          </div>
          <div>
            <label className="etiqueta" htmlFor="displayName">Cómo te llamas</label>
            <input id="displayName" name="displayName" className="campo" required autoComplete="given-name" />
          </div>
          <Submit pendingLabel="Creando…">Crear hogar</Submit>
          {createState ? <Notice tone="error">{createState.message}</Notice> : null}
        </form>
      </Panel>
      <Panel>
        <h2 className="text-xl font-semibold">Unirme con un código</h2>
        <form action={join} className="mt-4 space-y-3">
          <div>
            <label className="etiqueta" htmlFor="code">Código de invitación</label>
            <input id="code" name="code" className="campo uppercase tracking-widest" placeholder="ABCD2345" required autoComplete="off" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="displayName2">Cómo te llamas</label>
            <input id="displayName2" name="displayName" className="campo" required autoComplete="given-name" />
          </div>
          <Submit kind="quiet" pendingLabel="Uniéndome…">Unirme al hogar</Submit>
          {joinState ? <Notice tone="error">{joinState.message}</Notice> : null}
        </form>
      </Panel>
    </div>
  );
}
