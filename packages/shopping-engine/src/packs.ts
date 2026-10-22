/**
 * Formatos comerciales: la combinación de envases que cubre la necesidad con
 * el menor exceso posible; a igual exceso, la de menos envases. Se resuelve
 * exacto con programación dinámica (pocos tamaños, gramos enteros).
 */

export interface PackSize {
  ingredientId: string;
  grams: number;
  label: string;
  price?: number | null;
}

export interface PackSuggestion {
  packs: { label: string; grams: number; count: number }[];
  totalG: number;
  surplusG: number;
  packCount: number;
  estimatedPrice: number | null;
}

export function suggestPacks(needG: number, sizes: PackSize[]): PackSuggestion | null {
  const valid = sizes.filter((s) => Number.isFinite(s.grams) && s.grams > 0);
  if (needG <= 0 || valid.length === 0) return null;
  const need = Math.ceil(needG - 1e-9);
  const maxPack = Math.max(...valid.map((s) => Math.round(s.grams)));
  const limit = need + maxPack;
  // best[w] = mínimo número de envases para sumar exactamente w gramos
  const best = new Int32Array(limit + 1).fill(-1);
  const from = new Int32Array(limit + 1).fill(-1);
  best[0] = 0;
  const grams = valid.map((s) => Math.round(s.grams));
  for (let w = 1; w <= limit; w++) {
    for (let k = 0; k < grams.length; k++) {
      const g = grams[k]!;
      if (g <= w && best[w - g]! >= 0) {
        const cand = best[w - g]! + 1;
        if (best[w]! < 0 || cand < best[w]!) {
          best[w] = cand;
          from[w] = k;
        }
      }
    }
  }
  let total = -1;
  for (let w = need; w <= limit; w++) {
    if (best[w]! >= 0) {
      total = w;
      break;
    }
  }
  if (total < 0) return null;
  const counts = new Map<number, number>();
  let w = total;
  while (w > 0) {
    const k = from[w]!;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    w -= grams[k]!;
  }
  const packs = [...counts.entries()]
    .sort((a, b) => grams[b[0]]! - grams[a[0]]!)
    .map(([k, count]) => ({ label: valid[k]!.label, grams: grams[k]!, count }));
  const prices = [...counts.entries()].map(([k, c]) => (valid[k]!.price == null ? null : valid[k]!.price! * c));
  return {
    packs,
    totalG: total,
    surplusG: total - needG,
    packCount: best[total]!,
    estimatedPrice: prices.some((p) => p === null) ? null : prices.reduce<number>((a, p) => a + (p ?? 0), 0),
  };
}
