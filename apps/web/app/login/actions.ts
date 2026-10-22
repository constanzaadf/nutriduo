"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { ok: boolean; message: string } | null;

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().trim().email().safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Escribe un correo válido." };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { ok: false, message: `No se pudo enviar el enlace: ${error.message}` };
  return { ok: true, message: `Te enviamos un enlace a ${parsed.data}. Ábrelo en este mismo dispositivo para entrar.` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
