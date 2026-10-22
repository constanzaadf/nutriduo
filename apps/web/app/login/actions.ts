"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoginState = { ok: boolean; message: string } | null;

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.string().trim().email().safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Escribe un correo válido." };
  const h = await headers();
  // La dirección real desde donde se pidió el enlace (en Vercel, el dominio público).
  // NEXT_PUBLIC_SITE_URL queda solo como respaldo: se fija al compilar y puede quedar en localhost.
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const fromRequest = host ? `${proto}://${host}` : null;
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const origin = fromRequest ?? configured ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    if (/rate limit/i.test(error.message) || error.status === 429) {
      return { ok: false, message: "Se alcanzó el límite de correos por hora del servicio de correo. Espera alrededor de una hora y vuelve a pedir el enlace." };
    }
    return { ok: false, message: `No se pudo enviar el enlace: ${error.message}` };
  }
  return { ok: true, message: `Te enviamos un enlace a ${parsed.data}. Ábrelo en este mismo dispositivo para entrar.` };
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Escribe un correo válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(72, "La contraseña es demasiado larga."),
});

export async function signInWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (/invalid login credentials/i.test(error.message)) {
      return { ok: false, message: "Correo o contraseña incorrectos. Si tu cuenta la creaste con enlace por correo, entra con el enlace y define una contraseña en Configuración." };
    }
    return { ok: false, message: `No se pudo entrar: ${error.message}` };
  }
  redirect("/dashboard");
}

/**
 * Crea la cuenta desde el servidor ya confirmada, para no depender del correo
 * (el servicio de correo gratuito de Supabase permite muy pocos envíos por hora).
 */
export async function signUpWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  if (formData.get("password") !== formData.get("confirm")) return { ok: false, message: "Las contraseñas no coinciden." };

  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (createError) {
    if (/already|registered|exists/i.test(createError.message)) {
      return { ok: false, message: "Ese correo ya tiene cuenta. Entra con tu contraseña, o con el enlace por correo si nunca definiste una." };
    }
    return { ok: false, message: `No se pudo crear la cuenta: ${createError.message}` };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: `La cuenta se creó, pero no se pudo entrar: ${error.message}` };
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
