"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyDiff } from "@nutriduo/shopping-engine";
import { requireContext } from "@/lib/session";
import { computeWeekShopping, rowsFromDiff, SHOPPING_RUN_VERSION } from "@/lib/engines/shopping";
import { fnv1a } from "@nutriduo/portion-engine";

/** Recalcula y aplica: se recalcula en el momento de aplicar para no guardar un diff viejo. */
export async function applyShopping(fd: FormData) {
  const ctx = await requireContext();
  const week = String(fd.get("semana"));
  const ws = await computeWeekShopping(ctx.supabase, ctx.household.id, week);
  const rows = rowsFromDiff(ws.diff, ws.next, ws.existing);
  await ctx.supabase.rpc("apply_shopping_items", {
    p_list: ws.listId,
    p_items: rows,
    p_run: {
      engine_version: SHOPPING_RUN_VERSION,
      input_hash: fnv1a(JSON.stringify(ws.next.map((l) => l.sourceHash))),
      inputs: { week, lines: ws.next.length },
      outputs: { applied: applyDiff(ws.diff).length },
    },
  });
  revalidatePath("/compras");
  revalidatePath("/dashboard");
  redirect(`/compras?semana=${week}`);
}

export async function toggleItem(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("id"));
  const checked = fd.get("checked") === "true";
  const buy = Number(fd.get("buy_g") ?? 0);
  await ctx.supabase.from("shopping_list_items").update({ checked: !checked, checked_g: !checked ? buy : 0 }).eq("id", id);
  revalidatePath("/compras");
}

export async function addManualItem(fd: FormData) {
  const ctx = await requireContext();
  const label = String(fd.get("label") ?? "").trim();
  const listId = String(fd.get("list_id"));
  if (!label) return;
  await ctx.supabase.from("shopping_list_items").insert({
    list_id: listId,
    key: `manual:${label.toLowerCase()}:${Date.now()}`,
    label,
    manual: true,
    manual_quantity: String(fd.get("quantity") ?? "").trim() || null,
    category: "otros",
  });
  revalidatePath("/compras");
}

export async function removeItem(fd: FormData) {
  const ctx = await requireContext();
  await ctx.supabase.from("shopping_list_items").delete().eq("id", String(fd.get("id"))).eq("manual", true);
  revalidatePath("/compras");
}

/** Pasa lo comprado al inventario (un toque, no automático). */
export async function moveCheckedToPantry(fd: FormData) {
  const ctx = await requireContext();
  const listId = String(fd.get("list_id"));
  const { data: items } = await ctx.supabase.from("shopping_list_items").select("id, ingredient_id, state, checked_g, buy_g, pack_suggestion").eq("list_id", listId).eq("checked", true).eq("manual", false);
  for (const i of items ?? []) {
    const pack = i.pack_suggestion as { totalG?: number } | null;
    const g = Number(pack?.totalG ?? i.checked_g ?? i.buy_g ?? 0);
    if (!i.ingredient_id || g <= 0) continue;
    await ctx.supabase.from("inventory_items").insert({ household_id: ctx.household.id, ingredient_id: i.ingredient_id, grams: g, state: i.state === "cooked" ? "cooked" : (i.state ?? "raw"), location: "pantry" });
  }
  revalidatePath("/inventario");
  revalidatePath("/compras");
}
