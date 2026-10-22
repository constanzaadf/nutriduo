"use client";

import { useActionState } from "react";
import { Submit } from "@/components/submit";
import { Notice } from "@/components/ui";
import { changePassword, type FormState } from "./actions";

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changePassword, null);
  return (
    <form action={action} className="space-y-3" key={state?.ok ? "ok" : "form"}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="etiqueta">Contraseña nueva</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required className="campo" />
        </label>
        <label className="text-sm">
          <span className="etiqueta">Repítela</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className="campo" />
        </label>
      </div>
      <Submit kind="quiet">Guardar contraseña</Submit>
      {state ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
    </form>
  );
}
