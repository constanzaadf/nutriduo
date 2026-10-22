import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-[60ch]">
        <h1 className="text-[1.9rem] font-semibold sm:text-[2.25rem]">{title}</h1>
        {lead ? <p className="mt-1.5 text-tinta-suave">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const btnKinds = {
  primary: "bg-salvia text-papel hover:bg-salvia-oscuro",
  quiet: "border border-avena-fuerte bg-papel text-tinta hover:border-tinta-suave",
  ghost: "text-tinta-suave hover:text-tinta hover:bg-avena/40",
  danger: "border border-ladrillo/40 bg-papel text-ladrillo hover:bg-ladrillo-claro",
} as const;

export function Button({ kind = "primary", className, ...rest }: ComponentProps<"button"> & { kind?: keyof typeof btnKinds }) {
  return <button className={cx(btnBase, btnKinds[kind], className)} {...rest} />;
}

export function LinkButton({ kind = "primary", className, ...rest }: ComponentProps<typeof Link> & { kind?: keyof typeof btnKinds }) {
  return <Link className={cx(btnBase, btnKinds[kind], className)} {...rest} />;
}

export function Panel({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-[var(--radius-plato)] border border-avena bg-papel p-4 sm:p-5", className)} {...rest}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const tones = {
    info: "border-avena bg-papel text-tinta",
    warn: "border-miel/40 bg-miel-claro text-tinta",
    error: "border-ladrillo/40 bg-ladrillo-claro text-tinta",
    ok: "border-salvia/40 bg-salvia-claro text-tinta",
  };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone])} role={tone === "error" ? "alert" : undefined}>{children}</div>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "error" }) {
  const tones = {
    neutral: "bg-avena/50 text-tinta-suave",
    ok: "bg-salvia-claro text-salvia-oscuro",
    warn: "bg-miel-claro text-miel",
    error: "bg-ladrillo-claro text-ladrillo",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

/** Barra de avance: planificado/consumido frente al objetivo. Pasarse se ve, no se castiga. */
export function MeterRow({ label, value, target, unit = "g", estimated = false }: { label: string; value: number; target: number; unit?: string; estimated?: boolean }) {
  const ratio = target > 0 ? value / target : 0;
  const width = Math.min(ratio, 1) * 100;
  const over = ratio > 1.05;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
      <span className="text-tinta-suave">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-avena/60" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(value)} aria-label={label}>
        <div className={cx("h-full rounded-full", over ? "bg-miel" : "bg-salvia")} style={{ width: `${width}%` }} />
      </div>
      <span className="cifra whitespace-nowrap text-right">
        {estimated ? "≈ " : ""}
        {Math.round(value)}
        <span className="text-tinta-suave"> / {Math.round(target)} {unit}</span>
      </span>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-plato)] border border-dashed border-avena-fuerte px-5 py-8 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-[46ch] text-sm text-tinta-suave">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PersonDot({ tone, name }: { tone: 0 | 1; name: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm font-medium", `tono-${tone}`)}>
      <span className="h-2.5 w-2.5 rounded-full bg-[var(--tono)]" aria-hidden />
      {name}
    </span>
  );
}
