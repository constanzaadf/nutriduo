import type { FoodState } from "@nutriduo/domain";
import type { SharedMealPlan } from "@nutriduo/portion-engine";

/**
 * Una "demanda" es una cantidad de un ingrediente que hay que tener en casa
 * para una fecha. Nace de lo que se COCINA, no de lo que se sirve: una
 * porción servida desde un lote ya existente no genera demanda (el lote ya
 * se compró), y eso es lo que evita la doble contabilización.
 */
export interface DemandSource {
  kind: "event" | "batch" | "manual";
  refId: string;
  /** null = compartido. */
  participantId: string | null;
  date: string; // YYYY-MM-DD
}

export interface Demand {
  ingredientId: string;
  grams: number;
  state: FoodState;
  source: DemandSource;
}

/** Demandas de una comida planificada con `planSharedMeal` (1 o más participantes). */
export function demandsFromMealPlan(eventId: string, date: string, plan: SharedMealPlan): Demand[] {
  const out: Demand[] = [];
  for (const l of plan.cookLines) {
    if (l.grams <= 0) continue;
    out.push({
      ingredientId: l.ingredientId,
      grams: l.grams,
      state: l.state,
      source: { kind: "event", refId: eventId, participantId: l.forParticipant, date },
    });
  }
  // La mezcla se compra solo si se cocina para esta comida (no si sale de un lote).
  if (plan.mix && !plan.mix.fromBatch) {
    for (const l of plan.mix.cookRawLines) {
      if (l.grams <= 0) continue;
      out.push({
        ingredientId: l.ingredientId,
        grams: l.grams,
        state: l.state,
        source: { kind: "event", refId: eventId, participantId: null, date },
      });
    }
  }
  return out;
}

/** Demandas de un lote planificado (batch cooking): sus ingredientes crudos. */
export function demandsFromBatch(
  batchId: string,
  cookDate: string,
  rawLines: { ingredientId: string; grams: number; state: FoodState }[],
): Demand[] {
  return rawLines
    .filter((l) => l.grams > 0)
    .map((l) => ({
      ingredientId: l.ingredientId,
      grams: l.grams,
      state: l.state,
      source: { kind: "batch" as const, refId: batchId, participantId: null, date: cookDate },
    }));
}
