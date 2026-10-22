import Link from "next/link";
import type { ReactNode } from "react";
import { requireContext, personTone } from "@/lib/session";
import { cx } from "@/components/ui";
import { signOut } from "../login/actions";
import { BottomNav, SideNav } from "./nav";
import { setActiveProfile } from "./shell-actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="mx-auto flex min-h-dvh max-w-[90rem]">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-avena px-4 py-6 md:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2">
          <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
            <circle cx="32" cy="32" r="28" fill="#fffcf6" stroke="#1f2d24" strokeWidth="3" />
            <path d="M32 6a26 26 0 0 0 0 52z" fill="#5f7d58" />
            <path d="M32 6a26 26 0 0 1 0 52z" fill="#8a6680" />
            <circle cx="32" cy="32" r="13" fill="#fffcf6" />
          </svg>
          <span className="font-display text-xl font-semibold">NutriDuo</span>
        </Link>
        <SideNav />
        <div className="mt-auto space-y-1 px-2 text-sm text-tinta-suave">
          <p className="truncate">{ctx.household.name}</p>
          <form action={signOut}>
            <button className="underline-offset-2 hover:underline">Cerrar sesión</button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-avena bg-masa/95 px-4 py-2.5 backdrop-blur sm:px-6">
          <span className="font-display text-lg font-semibold md:hidden">NutriDuo</span>
          <ProfileSwitcher ctx={ctx} />
        </div>
        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}

function ProfileSwitcher({ ctx }: { ctx: Awaited<ReturnType<typeof requireContext>> }) {
  return (
    <form action={setActiveProfile} className="ml-auto flex items-center gap-1 rounded-full border border-avena bg-papel p-1" aria-label="Ver como">
      {ctx.people.map((p) => {
        const on = p.profile_id === ctx.active.profile_id;
        const disabled = !p.is_me && p.my_view_level === "private";
        return (
          <button
            key={p.profile_id}
            name="profileId"
            value={p.profile_id}
            disabled={disabled}
            title={disabled ? `${p.display_name} no comparte su información` : `Ver como ${p.display_name}`}
            aria-pressed={on}
            className={cx(
              `tono-${personTone(ctx.people, p.profile_id)}`,
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm",
              on ? "bg-[var(--tono-claro)] font-semibold text-tinta" : "text-tinta-suave hover:text-tinta",
              disabled && "opacity-40",
            )}
          >
            <span className="h-2 w-2 rounded-full bg-[var(--tono)]" aria-hidden />
            {p.is_me ? `${p.display_name} (yo)` : p.display_name}
          </button>
        );
      })}
    </form>
  );
}
