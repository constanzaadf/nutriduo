import type { Confidence } from "@nutriduo/domain";

const nf0 = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

export function grams(g: number | null | undefined): string {
  if (g == null || !Number.isFinite(g)) return "—";
  if (g >= 1000) return `${nf1.format(g / 1000)} kg`;
  return `${nf0.format(g)} g`;
}

/** Cifra con su rótulo de confianza: los estimados llevan ≈ y nunca decimales. */
export function kcal(v: number | null | undefined, confidence: Confidence = "calculated"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const rounded = Math.round(v / 10) * 10;
  return `${confidence === "estimated" ? "≈ " : ""}${nf0.format(rounded)} kcal`;
}

export function macro(v: number | null | undefined, confidence: Confidence = "calculated"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.abs(v) < 10 ? Math.round(v) : Math.round(v / 5) * 5;
  return `${confidence === "estimated" ? "≈ " : ""}${nf0.format(r)} g`;
}

export function pct(v: number): string {
  return `${nf0.format(v * 100)} %`;
}

export function money(v: number | null | undefined, currency = "CLP"): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
}

export const STATE_LABEL: Record<string, string> = { raw: "crudo", cooked: "cocido", as_sold: "" };

export const MODE_LABEL: Record<string, string> = {
  A: "Compartida",
  B: "Individual",
  C: "Compartida con ajustes",
};
