import type { MacroTarget } from "./compute";

/**
 * Reparto de la meta diaria por tiempo de comida y cálculo del presupuesto
 * de un evento. La redistribución solo ocurre durante la planificación y
 * solo hacia slots aún sin planificar del MISMO día; el consumo registrado
 * nunca modifica presupuestos (regla de no compensar).
 */

export type MealSlot = "breakfast" | "snack_am" | "lunch" | "snack_pm" | "dinner" | "extra";

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner", "extra"];

export const SLOT_LABEL_ES: Record<MealSlot, string> = {
  breakfast: "Desayuno",
  snack_am: "Snack mañana",
  lunch: "Almuerzo",
  snack_pm: "Snack tarde",
  dinner: "Cena",
  extra: "Adicional",
};

export type SlotShares = Partial<Record<MealSlot, number>>;

export const DEFAULT_SLOT_SHARES: SlotShares = {
  breakfast: 0.25,
  snack_am: 0.1,
  lunch: 0.3,
  snack_pm: 0.1,
  dinner: 0.25,
};

export function validateShares(shares: SlotShares): void {
  const total = Object.values(shares).reduce((a, b) => a + (b ?? 0), 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new RangeError(`Los porcentajes por tiempo de comida deben sumar 100 % (suman ${(total * 100).toFixed(1)} %)`);
  }
  for (const [k, v] of Object.entries(shares)) {
    if (v == null || v < 0) throw new RangeError(`Porcentaje inválido para ${k}`);
  }
}

function scale(t: MacroTarget, f: number): MacroTarget {
  return {
    kcal: t.kcal * f,
    protein_g: t.protein_g * f,
    carbs_g: t.carbs_g * f,
    fat_g: t.fat_g * f,
    fiber_g: t.fiber_g * f,
  };
}

export interface PlannedSlot {
  slot: MealSlot;
  /** Nutrientes ya asignados (porciones aprobadas) en ese slot del día. */
  planned: MacroTarget;
}

export interface SlotBudgetOptions {
  /** Tope de la redistribución sobre la meta original del slot (0,15 = ±15 %). */
  maxRedistribution?: number;
}

/**
 * Presupuesto para `slot` en un día, dados los slots de ese día que ya están
 * aprobados. La diferencia (meta − planificado) de los slots aprobados se
 * reparte entre los slots NO planificados en proporción a sus shares, con tope.
 */
export function slotBudget(
  daily: MacroTarget,
  shares: SlotShares,
  slot: MealSlot,
  approvedToday: PlannedSlot[],
  opts: SlotBudgetOptions = {},
): { budget: MacroTarget; redistributed: number } {
  validateShares(shares);
  const cap = opts.maxRedistribution ?? 0.15;
  const share = shares[slot] ?? 0;
  const base = scale(daily, share);
  if (share === 0) return { budget: base, redistributed: 0 };

  const approvedSlots = new Set(approvedToday.map((a) => a.slot));
  if (approvedSlots.has(slot)) return { budget: base, redistributed: 0 };

  const openShare = Object.entries(shares)
    .filter(([s, v]) => !approvedSlots.has(s as MealSlot) && (v ?? 0) > 0)
    .reduce((a, [, v]) => a + (v ?? 0), 0);
  if (openShare <= 0) return { budget: base, redistributed: 0 };

  const keys: (keyof MacroTarget)[] = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"];
  const out = { ...base };
  let redistributedKcal = 0;
  for (const k of keys) {
    let gap = 0;
    for (const a of approvedToday) {
      const target = daily[k] * (shares[a.slot] ?? 0);
      gap += target - a.planned[k];
    }
    const delta = gap * (share / openShare);
    const limit = Math.abs(base[k]) * cap;
    const applied = Math.max(-limit, Math.min(limit, delta));
    out[k] = Math.max(0, base[k] + applied);
    if (k === "kcal") redistributedKcal = applied;
  }
  return { budget: out, redistributed: redistributedKcal };
}
