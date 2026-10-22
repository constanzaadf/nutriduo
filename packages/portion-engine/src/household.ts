import { roundToStep, type FoodState, type Ingredient, type RecipeVersion } from "@nutriduo/domain";
import { nominalMix } from "./items";
import { solvePortions } from "./solve";
import type { MixInfo, PortionRequest, PortionResult } from "./types";

/**
 * Coordina una comida compartida (modalidad A o C): resuelve una porción por
 * participante —nunca mezcla presupuestos— y consolida lo que hay que cocinar
 * y cómo repartirlo.
 */

export type ParticipantSpec = Omit<PortionRequest, "recipe" | "ingredients" | "mix">;

export interface SharedMealInput {
  recipe: RecipeVersion;
  ingredients: ReadonlyMap<string, Ingredient>;
  participants: ParticipantSpec[];
  /** Si la mezcla sale de un lote existente: su composición y peso, y cuánto queda disponible. */
  batch?: { mix: MixInfo; availableG: number };
  /** Cuánto cocinar de la mezcla: lo justo o un número de porciones nominales (para que sobre). */
  cook?: { kind: "exact" } | { kind: "servings"; servings: number };
}

export interface CookLine {
  ingredientId: string;
  label: string;
  grams: number;
  state: FoodState;
  /** null = se cocina una vez para todos; id = exclusivo de ese participante. */
  forParticipant: string | null;
}

export interface MixPlan {
  /** Gramos cocidos que se reparten entre participantes. */
  allocations: { participantId: string; grams: number }[];
  allocatedG: number;
  /** Desde un lote: no se cocina la mezcla. */
  fromBatch: boolean;
  /** Si se cocina: ingredientes crudos de la olla, ya escalados. */
  cookRawLines: CookLine[];
  expectedCookedG: number;
  measured: boolean;
  leftoverG: number;
  batchInsufficient: boolean;
}

export interface SharedMealPlan {
  portions: PortionResult[];
  /** Participantes que no pueden comer la base: requiere variante (C) o comidas separadas (B). */
  blocked: { participantId: string; blockedBy: { ingredientId: string; reason: string }[] }[];
  cookLines: CookLine[];
  mix: MixPlan | null;
}

export function planSharedMeal(input: SharedMealInput): SharedMealPlan {
  const { recipe, ingredients } = input;
  const mix = recipe.isHomogeneous ? input.batch?.mix ?? nominalMix(recipe, ingredients) : undefined;

  const portions = input.participants.map((p) =>
    solvePortions({ ...p, recipe, ingredients, ...(mix ? { mix } : {}) }),
  );
  const blocked = portions
    .filter((r) => r.status === "blocked_by_restriction")
    .map((r) => ({ participantId: r.participantId, blockedBy: r.blockedBy ?? [] }));

  // Líneas separables y acompañamientos
  const shared = new Map<string, CookLine>();
  const exclusive: CookLine[] = [];
  for (const r of portions) {
    for (const it of r.items) {
      if (it.kind === "mix" || !it.ingredientId) continue;
      if (it.kind === "extra") {
        exclusive.push({ ingredientId: it.ingredientId, label: it.label, grams: it.grams, state: it.state, forParticipant: r.participantId });
      } else {
        const key = `${it.ingredientId}|${it.state}`;
        const prev = shared.get(key);
        if (prev) prev.grams += it.grams;
        else shared.set(key, { ingredientId: it.ingredientId, label: it.label, grams: it.grams, state: it.state, forParticipant: null });
      }
    }
  }
  const cookLines = [...shared.values(), ...exclusive];

  let mixPlan: MixPlan | null = null;
  if (mix) {
    const allocations = portions
      .map((r) => ({ participantId: r.participantId, grams: r.items.find((i) => i.kind === "mix")?.grams ?? 0 }))
      .filter((a) => a.grams > 0);
    const allocatedG = allocations.reduce((a, b) => a + b.grams, 0);
    if (input.batch) {
      mixPlan = {
        allocations,
        allocatedG,
        fromBatch: true,
        cookRawLines: [],
        expectedCookedG: input.batch.mix.cookedTotalG,
        measured: input.batch.mix.measured,
        leftoverG: Math.max(0, input.batch.availableG - allocatedG),
        batchInsufficient: allocatedG > input.batch.availableG + 1e-9,
      };
    } else {
      const recipeRawPerServing = recipe.lines.filter((l) => l.role !== "side").reduce((a, l) => a + l.grams, 0);
      const potRaw = mix.rawLines.reduce((a, l) => a + l.grams, 0);
      const servingsInPot = recipeRawPerServing > 0 ? potRaw / recipeRawPerServing : recipe.servingsNominal;
      const nominalPortion = mix.cookedTotalG / servingsInPot;
      const cook = input.cook ?? { kind: "exact" };
      const targetCooked = cook.kind === "exact" ? allocatedG : Math.max(allocatedG, cook.servings * nominalPortion);
      const scale = targetCooked / mix.cookedTotalG;
      const cookRawLines: CookLine[] = mix.rawLines.map((l) => ({
        ingredientId: l.ingredientId,
        label: ingredients.get(l.ingredientId)?.name ?? l.ingredientId,
        grams: roundToStep(l.grams * scale, l.grams * scale < 20 ? 1 : 5),
        state: l.state,
        forParticipant: null,
      }));
      mixPlan = {
        allocations,
        allocatedG,
        fromBatch: false,
        cookRawLines,
        expectedCookedG: targetCooked,
        measured: false,
        leftoverG: Math.max(0, targetCooked - allocatedG),
        batchInsufficient: false,
      };
    }
  }

  return { portions, blocked, cookLines, mix: mixPlan };
}

/** Instrucciones de reparto en lenguaje claro, con los nombres que entrega la UI. */
export function splitInstructions(plan: SharedMealPlan, names: Record<string, string>): string[] {
  const out: string[] = [];
  const n = (id: string) => names[id] ?? id;
  if (plan.mix) {
    const parts = plan.mix.allocations.map((a) => `${n(a.participantId)} ${Math.round(a.grams)} g`);
    const left = plan.mix.leftoverG >= 10 ? ` · sobran ${Math.round(plan.mix.leftoverG)} g` : "";
    out.push(`De la preparación: ${parts.join(" · ")}${left}.`);
  }
  for (const r of plan.portions) {
    const sides = r.items.filter((i) => i.kind !== "mix");
    if (sides.length === 0) continue;
    const txt = sides
      .map((i) => (i.units !== undefined ? `${i.units} × ${i.label}` : `${i.label} ${Math.round(i.grams)} g${i.state === "raw" ? " (crudo)" : ""}`))
      .join(", ");
    out.push(`${n(r.participantId)}: ${txt}.`);
  }
  return out;
}
