import "server-only";
import type { SharedMealPlan } from "@nutriduo/portion-engine";
import {
  SHOPPING_ENGINE_VERSION,
  buildShoppingList,
  demandsFromBatch,
  demandsFromMealPlan,
  diffLists,
  type Demand,
  type DiffEntry,
  type ExistingItem,
  type InventoryLot,
  type PackSize,
  type ShoppingLine,
} from "@nutriduo/shopping-engine";
import { loadIngredients } from "../data/catalog";
import { weekDays } from "../dates";
import type { ServerClient } from "../supabase/server";
import { num, type BatchRow, type ShoppingItemRow } from "../types";

export interface WeekShopping {
  listId: string;
  planId: string | null;
  next: ShoppingLine[];
  diff: DiffEntry[];
  existing: ShoppingItemRow[];
}

/** Asegura que exista la lista activa de la semana. */
export async function ensureWeekList(db: ServerClient, householdId: string, isoWeek: string): Promise<{ listId: string; planId: string }> {
  const { data: planIdData, error: e1 } = await db.rpc("ensure_meal_plan", { p_household: householdId, p_date: weekDays(isoWeek)[0] });
  if (e1) throw new Error(e1.message);
  const planId = planIdData as string;
  const { data: list } = await db.from("shopping_lists").select("id").eq("plan_id", planId).eq("status", "active").maybeSingle();
  if (list) return { listId: list.id as string, planId };
  const { data: created, error: e2 } = await db.from("shopping_lists").insert({ household_id: householdId, plan_id: planId }).select("id").single();
  if (e2 || !created) throw new Error(e2?.message ?? "No se pudo crear la lista");
  return { listId: created.id as string, planId };
}

/**
 * Recalcula la lista de la semana a partir de lo que se COCINA (no de lo que
 * se sirve): las cantidades a cocinar quedaron guardadas en la traza de cada
 * comida aprobada. Devuelve el diff contra la lista guardada, sin aplicarlo.
 */
export async function computeWeekShopping(db: ServerClient, householdId: string, isoWeek: string): Promise<WeekShopping> {
  const { listId, planId } = await ensureWeekList(db, householdId, isoWeek);
  const days = weekDays(isoWeek);

  const { data: events } = await db
    .from("meal_events")
    .select("id, date, plan_status")
    .eq("household_id", householdId)
    .gte("date", days[0]!)
    .lte("date", days[6]!)
    .eq("plan_status", "approved");
  const eventIds = (events ?? []).map((e) => e.id as string);
  const eventDate = new Map<string, string>((events ?? []).map((e: { id: string; date: string }) => [e.id, e.date]));

  const demands: Demand[] = [];
  if (eventIds.length > 0) {
    const { data: runs } = await db
      .from("calculation_runs")
      .select("inputs, outputs, created_at")
      .eq("engine", "portions")
      .in("inputs->>event_id", eventIds)
      .order("created_at", { ascending: false });
    const seen = new Set<string>();
    for (const run of (runs ?? []) as { inputs: { event_id: string }; outputs: { cook?: { lines: SharedMealPlan["cookLines"]; mix: SharedMealPlan["mix"] } } }[]) {
      const id = run.inputs.event_id;
      if (seen.has(id) || !run.outputs.cook) continue; // solo la traza más reciente de cada comida
      seen.add(id);
      const plan: SharedMealPlan = { portions: [], blocked: [], cookLines: run.outputs.cook.lines, mix: run.outputs.cook.mix };
      demands.push(...demandsFromMealPlan(id, eventDate.get(id)!, plan));
    }
  }

  // Lotes planificados para cocinar esta semana: sus crudos entran una vez
  const { data: batches } = await db
    .from("cooking_batches")
    .select("*")
    .eq("household_id", householdId)
    .eq("status", "planned")
    .gte("planned_for", days[0]!)
    .lte("planned_for", days[6]!);
  for (const b of (batches ?? []) as BatchRow[]) {
    demands.push(...demandsFromBatch(b.id, b.planned_for!, b.raw_input.map((l) => ({ ingredientId: l.ingredientId, grams: num(l.grams), state: l.state }))));
  }

  const { data: inv } = await db.from("inventory_items").select("*").eq("household_id", householdId);
  const { data: reservations } = await db.from("inventory_reservations").select("inventory_item_id, grams, event_id, batch_id");
  const reservedOthers = new Map<string, number>();
  for (const r of (reservations ?? []) as { inventory_item_id: string; grams: unknown; event_id: string | null; batch_id: string | null }[]) {
    // Lo reservado para comidas de ESTA semana ya está en la demanda; lo demás no está disponible.
    if (r.event_id && eventIds.includes(r.event_id)) continue;
    reservedOthers.set(r.inventory_item_id, (reservedOthers.get(r.inventory_item_id) ?? 0) + num(r.grams));
  }
  const inventory: InventoryLot[] = (inv ?? []).map((i) => ({
    id: i.id as string,
    ingredientId: i.ingredient_id as string,
    grams: num(i.grams),
    state: i.state as InventoryLot["state"],
    expiresOn: (i.expires_on as string | null) ?? null,
    reservedForOthersG: reservedOthers.get(i.id as string) ?? 0,
  }));
  const { data: packs } = await db.from("pack_sizes").select("ingredient_id, grams, label, price").eq("household_id", householdId);
  const packSizes: PackSize[] = (packs ?? []).map((p) => ({ ingredientId: p.ingredient_id as string, grams: num(p.grams), label: p.label as string, price: p.price == null ? null : num(p.price) }));

  const ingredients = await loadIngredients(db, demands.map((d) => d.ingredientId), householdId);
  const next = buildShoppingList({ demands, ingredients, inventory, packSizes });

  const { data: existingRows } = await db.from("shopping_list_items").select("*").eq("list_id", listId).order("position");
  const existing = (existingRows ?? []) as ShoppingItemRow[];
  const diff = diffLists(existing.map(toExisting), next);
  return { listId, planId, next, diff, existing };
}

export function toExisting(r: ShoppingItemRow): ExistingItem {
  return {
    key: r.key,
    ingredientId: r.ingredient_id,
    label: r.label,
    buyG: num(r.buy_g),
    checked: r.checked,
    checkedG: num(r.checked_g),
    manual: r.manual,
    sourceHash: r.source_hash,
  };
}

/** Filas a guardar tras aceptar un diff (conserva categoría, formato y precio calculados). */
export function rowsFromDiff(diff: DiffEntry[], next: ShoppingLine[], existing: ShoppingItemRow[]) {
  const byKey = new Map(next.map((l) => [l.key, l]));
  const oldByKey = new Map(existing.map((r) => [r.key, r]));
  return diff
    .filter((d) => d.proposed)
    .map((d, position) => {
      const p = d.proposed!;
      const line = byKey.get(p.key);
      const old = oldByKey.get(p.key);
      return {
        key: p.key,
        ingredient_id: p.ingredientId,
        label: p.label,
        category: line?.category ?? old?.category ?? "otros",
        state: line?.state ?? old?.state ?? null,
        need_g: line?.needG ?? 0,
        available_g: line?.availableG ?? 0,
        buy_g: p.buyG,
        checked: p.checked,
        checked_g: p.checkedG,
        manual: p.manual,
        manual_quantity: old?.manual_quantity ?? null,
        source_hash: p.sourceHash,
        pack_suggestion: line?.pack ?? null,
        estimated_price: line?.pack?.estimatedPrice ?? null,
        position,
      };
    });
}

export const SHOPPING_RUN_VERSION = SHOPPING_ENGINE_VERSION;
