import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3">
        <svg viewBox="0 0 64 64" className="h-11 w-11" aria-hidden>
          <circle cx="32" cy="32" r="28" fill="#fffcf6" stroke="#1f2d24" strokeWidth="3" />
          <path d="M32 6a26 26 0 0 0 0 52z" fill="#5f7d58" />
          <path d="M32 6a26 26 0 0 1 0 52z" fill="#8a6680" />
          <circle cx="32" cy="32" r="13" fill="#fffcf6" />
        </svg>
        <span className="font-display text-2xl font-semibold">NutriDuo</span>
      </div>
      <h1 className="text-[2.1rem] font-semibold">Dos metas, una cocina.</h1>
      <p className="mt-2 text-tinta-suave">
        Planifiquen la semana juntos y que cada uno reciba la porción que le corresponde, con una sola lista de compras.
      </p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </main>
  );
}
