"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { NAV_ITEMS as ITEMS } from "./nav-items";



function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Secciones" className="flex flex-col gap-1">
      {ITEMS.map((i) => {
        const on = path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={cx("flex items-center gap-3 rounded-xl px-3 py-2 text-[0.95rem]", on ? "bg-salvia-claro font-semibold text-salvia-oscuro" : "text-tinta-suave hover:bg-avena/40 hover:text-tinta")}
          >
            <Icon d={i.icon} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  const moreOn = ITEMS.some((i) => !i.mobile && path.startsWith(i.href)) || path.startsWith("/mas");
  return (
    <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-30 border-t border-avena bg-papel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {ITEMS.filter((i) => i.mobile).map((i) => {
          const on = path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined} className={cx("flex flex-col items-center gap-0.5 py-2 text-[0.7rem]", on ? "font-semibold text-salvia-oscuro" : "text-tinta-suave")}>
                <Icon d={i.icon} />
                {i.label}
              </Link>
            </li>
          );
        })}
        <li>
          <Link href="/mas" aria-current={moreOn ? "page" : undefined} className={cx("flex flex-col items-center gap-0.5 py-2 text-[0.7rem]", moreOn ? "font-semibold text-salvia-oscuro" : "text-tinta-suave")}>
            <Icon d="M5 12h.01M12 12h.01M19 12h.01" />
            Más
          </Link>
        </li>
      </ul>
    </nav>
  );
}

