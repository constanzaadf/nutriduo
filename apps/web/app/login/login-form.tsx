"use client";

import { useActionState, useState } from "react";
import { Submit } from "@/components/submit";
import { Notice, cx } from "@/components/ui";
import { sendMagicLink, signInWithPassword, signUpWithPassword, type LoginState } from "./actions";

type Tab = "entrar" | "crear" | "enlace";

export function LoginForm() {
  const [tab, setTab] = useState<Tab>("entrar");
  const [signInState, signIn] = useActionState<LoginState, FormData>(signInWithPassword, null);
  const [signUpState, signUp] = useActionState<LoginState, FormData>(signUpWithPassword, null);
  const [linkState, link] = useActionState<LoginState, FormData>(sendMagicLink, null);

  return (
    <div>
      <div role="tablist" aria-label="Forma de entrar" className="mb-5 flex gap-1 rounded-full bg-avena/50 p-1 text-sm">
        {(
          [
            ["entrar", "Entrar"],
            ["crear", "Crear cuenta"],
            ["enlace", "Enlace por correo"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("flex-1 rounded-full px-3 py-1.5", tab === k ? "bg-papel font-semibold" : "text-tinta-suave")}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "entrar" ? (
        <form action={signIn} className="space-y-3">
          <div>
            <label className="etiqueta" htmlFor="email-in">Tu correo</label>
            <input id="email-in" name="email" type="email" autoComplete="email" required className="campo" placeholder="nombre@correo.cl" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="password-in">Contraseña</label>
            <input id="password-in" name="password" type="password" autoComplete="current-password" required minLength={8} className="campo" />
          </div>
          <Submit className="w-full" pendingLabel="Entrando…">Entrar</Submit>
          {signInState ? <Notice tone="error">{signInState.message}</Notice> : null}
          <p className="text-xs text-tinta-suave">¿Olvidaste la contraseña? Entra con “Enlace por correo” y define una nueva en Configuración.</p>
        </form>
      ) : null}

      {tab === "crear" ? (
        <form action={signUp} className="space-y-3">
          <div>
            <label className="etiqueta" htmlFor="email-up">Tu correo</label>
            <input id="email-up" name="email" type="email" autoComplete="email" required className="campo" placeholder="nombre@correo.cl" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="password-up">Contraseña (mínimo 8 caracteres)</label>
            <input id="password-up" name="password" type="password" autoComplete="new-password" required minLength={8} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="confirm-up">Repite la contraseña</label>
            <input id="confirm-up" name="confirm" type="password" autoComplete="new-password" required minLength={8} className="campo" />
          </div>
          <Submit className="w-full" pendingLabel="Creando cuenta…">Crear cuenta</Submit>
          {signUpState ? <Notice tone="error">{signUpState.message}</Notice> : null}
          <p className="text-xs text-tinta-suave">La cuenta queda lista al instante; no necesitas confirmar por correo.</p>
        </form>
      ) : null}

      {tab === "enlace" ? (
        <form action={link} className="space-y-3">
          <div>
            <label className="etiqueta" htmlFor="email-link">Tu correo</label>
            <input id="email-link" name="email" type="email" autoComplete="email" required className="campo" placeholder="nombre@correo.cl" />
          </div>
          <Submit className="w-full" pendingLabel="Enviando…">Recibir enlace para entrar</Submit>
          {linkState ? <Notice tone={linkState.ok ? "ok" : "error"}>{linkState.message}</Notice> : null}
          <p className="text-xs text-tinta-suave">Te llega un enlace de un solo uso. El servicio de correo permite pocos envíos por hora: úsalo si olvidaste la contraseña.</p>
        </form>
      ) : null}
    </div>
  );
}
