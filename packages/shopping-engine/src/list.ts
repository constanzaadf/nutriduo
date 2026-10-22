import { convertState, type FoodState, type Ingredient, type IngredientCategory } from "@nutriduo/domain";
import { fnv1a } from "@nutriduo/portion-engine";
import type { Demand, DemandSource } from "./demands";
import { suggestPacks, type PackSize, type PackSuggestion } from "./packs";

export const SHOPPING_ENGINE_VERSION = "1.0.0";

export interface InventoryLot {
  id: string;
  ingredientId: string;
  grams: number;
  state: FoodState;
  expiresOn?: string | null;
  /** Gramos de este lote ya comprometidos para otros usos (otra semana, otro lote). */
  reservedForOthersG?: number;
}

export interface ShoppingLine {
  /** Clave estable: ingrediente + estado de compra. */
  key: string;
  ingredientId: string;
  label: string;
  category: IngredientCategory | "otros";
  /** Estado en que se compra (crudo / como se vende) o cocido si no hubo conversión posible. */
  state: FoodState;
  needG: number;
  availableG: number;
  buyG: number;
  pack: PackSuggestion | null;
  sources: DemandSource[];
  /** Hash de orígenes y cantidades: cambia si cambia por qué se necesita. */
  sourceHash: string;
  /** Hubo demandas en un estado que no se pudo convertir al de compra. */
  needsConversion: boolean;
}

export interface BuildListInput {
  demands: Demand[];
  ingredients: ReadonlyMap<string, Ingredient>;
  inventory?: InventoryLot[];
  packSizes?: PackSize[];
}

function purchaseState(s: FoodState): FoodState {
  return s === "cooked" ? "cooked" : s === "as_sold" ? "as_sold" : "raw";
}

function defaultYield(ing: Ingredient | undefined): number | undefined {
  const y = ing?.yieldFactors;
  if (!y) return undefined;
  return y["default"] ?? Object.values(y)[0];
}

/** Estados intercambiables para efectos de inventario: crudo y "como se vende" lo son. */
function compatible(a: FoodState, b: FoodState): boolean {
  const n = (s: FoodState) => (s === "as_sold" ? "raw" : s);
  return n(a) === n(b);
}

export function buildShoppingList(input: BuildListInput): ShoppingLine[] {
  const lines = new Map<string, ShoppingLine & { firstUse: string }>();

  for (const d of input.demands) {
    if (!(d.grams > 0)) continue;
    const ing = input.ingredients.get(d.ingredientId);
    // Lo cocido se compra crudo: convertir con rendimiento si se puede.
    let state = purchaseState(d.state);
    let grams = d.grams;
    let needsConversion = false;
    if (d.state === "cooked") {
      const raw = convertState(d.grams, "cooked", "raw", defaultYield(ing));
      if (raw !== null) {
        state = "raw";
        grams = raw;
      } else {
        needsConversion = true;
      }
    }
    // Unificar "crudo" y "como se vende" bajo el estado declarado del ingrediente
    if (state !== "cooked") state = ing?.nutrition.as_sold && !ing.nutrition.raw ? "as_sold" : "raw";
    const key = `${d.ingredientId}|${state}`;
    const prev = lines.get(key);
    if (prev) {
      prev.needG += grams;
      prev.sources.push(d.source);
      prev.needsConversion ||= needsConversion;
      if (d.source.date < prev.firstUse) prev.firstUse = d.source.date;
    } else {
      lines.set(key, {
        key,
        ingredientId: d.ingredientId,
        label: ing?.name ?? d.ingredientId,
        category: ing?.category ?? "otros",
        state,
        needG: grams,
        availableG: 0,
        buyG: 0,
        pack: null,
        sources: [d.source],
        sourceHash: "",
        needsConversion,
        firstUse: d.source.date,
      });
    }
  }

  const inventory = input.inventory ?? [];
  const out: ShoppingLine[] = [];
  for (const line of lines.values()) {
    // Inventario utilizable: mismo ingrediente, estado compatible, no vencido antes del primer uso.
    const usable = inventory
      .filter((lot) => lot.ingredientId === line.ingredientId && compatible(lot.state, line.state))
      .filter((lot) => !lot.expiresOn || lot.expiresOn >= line.firstUse)
      .reduce((a, lot) => a + Math.max(0, lot.grams - (lot.reservedForOthersG ?? 0)), 0);
    const availableG = Math.min(usable, line.needG);
    const buyG = Math.max(0, line.needG - usable);
    const sizes = (input.packSizes ?? []).filter((p) => p.ingredientId === line.ingredientId);
    const pack = buyG > 0 ? suggestPacks(buyG, sizes) : null;
    const sources = [...line.sources].sort((a, b) =>
      a.date === b.date ? (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0) : a.date < b.date ? -1 : 1,
    );
    const { firstUse: _f, ...rest } = line;
    out.push({
      ...rest,
      availableG,
      buyG,
      pack,
      sources,
      sourceHash: fnv1a(JSON.stringify([line.key, Math.round(line.needG * 100), sources])),
    });
  }
  const catOrder: string[] = ["verduras", "frutas", "carnes", "pescados", "huevos", "lacteos", "panaderia", "cereales", "legumbres", "frutos_secos", "grasas", "condimentos", "bebidas", "otros"];
  return out.sort((a, b) => {
    const ca = catOrder.indexOf(a.category);
    const cb = catOrder.indexOf(b.category);
    return ca !== cb ? ca - cb : a.label.localeCompare(b.label, "es");
  });
}

/* ─────────────────────── Diferencias contra la lista vigente ─────────────────────── */

export interface ExistingItem {
  key: string;
  ingredientId: string | null;
  label: string;
  buyG: number;
  checked: boolean;
  /** Gramos ya marcados como comprados (puede ser menor que buyG si la necesidad subió). */
  checkedG: number;
  manual: boolean;
  sourceHash: string | null;
}

export type DiffKind = "added" | "removed" | "increased" | "decreased" | "unchanged" | "kept_manual" | "orphan_checked";

export interface DiffEntry {
  kind: DiffKind;
  key: string;
  label: string;
  fromG: number;
  toG: number;
  /** Resultado propuesto para esa línea si se acepta el cambio (null = se elimina). */
  proposed: ExistingItem | null;
}

/**
 * Compara la lista guardada con la recalculada. Nada se pierde en silencio:
 * lo manual se conserva, lo marcado como comprado se conserva aunque ya no
 * se necesite (queda como "comprado, ya no se usa") y un aumento sobre algo
 * ya comprado se muestra como faltante.
 */
export function diffLists(existing: ExistingItem[], next: ShoppingLine[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const nextByKey = new Map(next.map((l) => [l.key, l]));
  const seen = new Set<string>();

  for (const e of existing) {
    seen.add(e.key);
    if (e.manual) {
      out.push({ kind: "kept_manual", key: e.key, label: e.label, fromG: e.buyG, toG: e.buyG, proposed: e });
      continue;
    }
    const n = nextByKey.get(e.key);
    if (!n || n.buyG <= 0) {
      if (e.checked || e.checkedG > 0) {
        out.push({ kind: "orphan_checked", key: e.key, label: e.label, fromG: e.buyG, toG: 0, proposed: { ...e, buyG: 0, sourceHash: null } });
      } else {
        out.push({ kind: "removed", key: e.key, label: e.label, fromG: e.buyG, toG: 0, proposed: null });
      }
      continue;
    }
    const delta = n.buyG - e.buyG;
    if (Math.abs(delta) < 0.5) {
      out.push({ kind: "unchanged", key: e.key, label: e.label, fromG: e.buyG, toG: n.buyG, proposed: { ...e, buyG: n.buyG, sourceHash: n.sourceHash } });
    } else if (delta > 0) {
      // Si ya estaba comprado, lo comprado se conserva y el faltante queda pendiente.
      const checkedG = e.checked ? Math.max(e.checkedG, e.buyG) : e.checkedG;
      out.push({
        kind: "increased",
        key: e.key,
        label: e.label,
        fromG: e.buyG,
        toG: n.buyG,
        proposed: { ...e, buyG: n.buyG, checked: checkedG >= n.buyG, checkedG, sourceHash: n.sourceHash },
      });
    } else {
      out.push({
        kind: "decreased",
        key: e.key,
        label: e.label,
        fromG: e.buyG,
        toG: n.buyG,
        proposed: { ...e, buyG: n.buyG, checked: e.checked || e.checkedG >= n.buyG, sourceHash: n.sourceHash },
      });
    }
  }
  for (const n of next) {
    if (seen.has(n.key) || n.buyG <= 0) continue;
    out.push({
      kind: "added",
      key: n.key,
      label: n.label,
      fromG: 0,
      toG: n.buyG,
      proposed: { key: n.key, ingredientId: n.ingredientId, label: n.label, buyG: n.buyG, checked: false, checkedG: 0, manual: false, sourceHash: n.sourceHash },
    });
  }
  return out;
}

/** Aplica un diff aceptado: devuelve la lista resultante. */
export function applyDiff(diff: DiffEntry[]): ExistingItem[] {
  return diff.flatMap((d) => (d.proposed ? [d.proposed] : []));
}

/** Diff que el usuario debería revisar (todo menos lo que no cambió). */
export function meaningfulChanges(diff: DiffEntry[]): DiffEntry[] {
  return diff.filter((d) => d.kind !== "unchanged" && d.kind !== "kept_manual");
}
