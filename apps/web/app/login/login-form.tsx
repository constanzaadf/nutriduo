"use client";

import { useActionState } from "react";
import { Submit } from "@/components/submit";
import { Notice } from "@/components/ui";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(sendMagicLink, null);
  return (
    <form action={action} className="space-y-3">
      <label className="etiqueta" htmlFor="email">
        Tu correo
      </label>
      <input id="email" name="email" type="email" autoComplete="email" required className="campo" placeholder="nombre@correo.cl" />
      <Submit className="w-full" pendingLabel="Enviando…">
        Recibir enlace para entrar
      </Submit>
      {state ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
      <p className="text-xs text-tinta-suave">No usamos contraseñas: cada vez que entres te llega un enlace de un solo uso.</p>
    </form>
  );
}
