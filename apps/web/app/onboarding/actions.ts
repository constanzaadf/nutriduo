"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { message: string } | null;

const name = z.string().trim().min(1, "Falta el nombre").max(80);

export async function createHousehold(_prev: OnboardingState, fd: FormData): Promise<OnboardingState> {
  const parsed = z.object({ household: name, displayName: name }).safeParse({ household: fd.get("household"), displayName: fd.get("displayName") });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Revisa los datos" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_household", { p_name: parsed.data.household, p_display_name: parsed.data.displayName });
  if (error) return { message: error.message };
  redirect("/config?bienvenida=1");
}

export async function joinHousehold(_prev: OnboardingState, fd: FormData): Promise<OnboardingState> {
  const parsed = z
    .object({ code: z.string().trim().min(6, "El código tiene 8 caracteres").max(12), displayName: name })
    .safeParse({ code: fd.get("code"), displayName: fd.get("displayName") });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Revisa los datos" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_household", { p_code: parsed.data.code, p_display_name: parsed.data.displayName });
  if (error) {
    if (error.hint === "invalid_invite") return { message: "Ese código no corresponde a ningún hogar. Pídele a tu pareja que lo revise en Configuración." };
    if (error.hint === "household_full") return { message: "Ese hogar ya tiene sus dos integrantes." };
    return { message: error.message };
  }
  redirect("/config?bienvenida=1");
}
