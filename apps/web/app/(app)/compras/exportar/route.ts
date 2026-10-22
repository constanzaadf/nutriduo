import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { num } from "@/lib/types";

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("semana") ?? "";
  if (!/^\d{4}-W\d{2}$/.test(week)) return new NextResponse("Semana inválida", { status: 400 });
  const supabase = await createClient();
  const { data: member } = await supabase.from("household_members").select("household_id").limit(1).maybeSingle();
  if (!member) return new NextResponse("Sin acceso", { status: 401 });
  const { data: plan } = await supabase.from("meal_plans").select("id").eq("household_id", member.household_id).eq("iso_week", week).maybeSingle();
  const { data: list } = plan ? await supabase.from("shopping_lists").select("id").eq("plan_id", plan.id).eq("status", "active").maybeSingle() : { data: null };
  const { data: items } = list ? await supabase.from("shopping_list_items").select("label, buy_g, manual, manual_quantity, checked, category, pack_suggestion").eq("list_id", list.id).order("position") : { data: [] };
  const lines = (items ?? [])
    .filter((i) => !i.checked && (i.manual || num(i.buy_g) > 0))
    .map((i) => {
      const pack = i.pack_suggestion as { packs?: { label: string; count: number }[] } | null;
      const qty = i.manual ? (i.manual_quantity ?? "") : pack?.packs?.length ? pack.packs.map((p) => `${p.count} × ${p.label}`).join(" + ") : `${Math.round(num(i.buy_g))} g`;
      return `- ${i.label}${qty ? `: ${qty}` : ""}`;
    });
  const body = `Lista de compras (${week})\n\n${lines.join("\n") || "Nada pendiente."}\n`;
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
  if (request.nextUrl.searchParams.get("descargar")) headers["Content-Disposition"] = `attachment; filename="compras-${week}.txt"`;
  return new NextResponse(body, { headers });
}
