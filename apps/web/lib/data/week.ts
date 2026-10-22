import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { num, type MealEventRow, type Slot } from "../types";

export interface WeekLane {
  participantId: string;
  profileId: string;
  /** null = sin acceso (visibilidad privada) o sin porción aprobada. */
  lines: { label: string; grams: number; kind: string; state: string; units: number | null }[] | null;
  macros: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; confidence: "prescribed" | "calculated" | "estimated"; status: string } | null;
}

export interface WeekEvent extends MealEventRow {
  recipeName: string;
  recipeId: string | null;
  lanes: WeekLane[];
}

export async function loadEvents(db: SupabaseClient, householdId: string, from: string, to: string): Promise<WeekEvent[]> {
  const { data: events } = await db
    .from("meal_events")
    .select("*, recipe_versions(name, recipe_id)")
    .eq("household_id", householdId)
    .gte("date", from)
    .lte("date", to)
    .neq("plan_status", "cancelled")
    .order("date");
  const evs = (events ?? []) as unknown as (MealEventRow & { recipe_versions: { name: string; recipe_id: string } | null })[];
  if (evs.length === 0) return [];
  const ids = evs.map((e) => e.id);
  const { data: parts } = await db.from("meal_participants").select("id, event_id, profile_id, active").in("event_id", ids).eq("active", true);
  const partRows = (parts ?? []) as { id: string; event_id: string; profile_id: string }[];
  const partIds = partRows.map((p) => p.id);
  const [{ data: portions }, { data: lines }] = await Promise.all([
    partIds.length ? db.from("meal_portions").select("id, participant_id, kcal, protein_g, carbs_g, fat_g, fiber_g, confidence, status").in("participant_id", partIds) : Promise.resolve({ data: [] }),
    // Gramos visibles según la visibilidad de cada persona (incluye "summary")
    db.rpc("event_portion_lines", { p_events: ids }),
  ]);
  type PortionLite = { participant_id: string; kcal: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown; fiber_g: unknown; confidence: string; status: string };
  const portionByPart = new Map(((portions ?? []) as PortionLite[]).map((p) => [p.participant_id, p]));
  const linesByPart = new Map<string, NonNullable<WeekLane["lines"]>>();
  for (const l of (lines ?? []) as { participant_id: string; label: string; grams: number; kind: string; state: string; units: number | null }[]) {
    const arr = linesByPart.get(l.participant_id) ?? [];
    arr.push({ label: l.label, grams: num(l.grams), kind: l.kind, state: l.state, units: l.units });
    linesByPart.set(l.participant_id, arr);
  }
  return evs.map((e) => ({
    ...e,
    recipeName: e.recipe_versions?.name ?? (e.plan_status === "eaten_out" ? "Comida fuera" : "Sin receta"),
    recipeId: e.recipe_versions?.recipe_id ?? null,
    lanes: partRows
      .filter((p) => p.event_id === e.id)
      .map((p) => {
        const po = portionByPart.get(p.id);
        return {
          participantId: p.id,
          profileId: p.profile_id,
          lines: linesByPart.get(p.id) ?? null,
          macros: po
            ? { kcal: num(po.kcal), protein_g: num(po.protein_g), carbs_g: num(po.carbs_g), fat_g: num(po.fat_g), fiber_g: num(po.fiber_g), confidence: po.confidence as "calculated", status: po.status as string }
            : null,
        };
      }),
  }));
}

export const SLOT_ORDER: Slot[] = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner", "extra"];
export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Desayuno",
  snack_am: "Snack mañana",
  lunch: "Almuerzo",
  snack_pm: "Snack tarde",
  dinner: "Cena",
  extra: "Adicional",
};

/** Resumen corto de una porción para la celda del calendario. */
export function laneSummary(lines: WeekLane["lines"]): string {
  if (!lines || lines.length === 0) return "—";
  const main = [...lines].sort((a, b) => (a.kind === "mix" ? -1 : b.kind === "mix" ? 1 : b.grams - a.grams)).slice(0, 2);
  return main.map((l) => (l.units != null ? `${l.units} ${l.label.toLowerCase()}` : `${Math.round(l.grams)} g ${l.kind === "mix" ? "" : l.label.toLowerCase()}`.trim())).join(" + ");
}
