import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./server";

/**
 * Cliente con service role. Se usa en UN solo caso: leer los insumos que el
 * motor necesita de la otra persona (meta del tiempo de comida, restricciones,
 * preferencias) al calcular una comida compartida. Antes de usarlo siempre se
 * verifica, con el cliente del usuario, que ambos pertenecen al mismo hogar; y
 * lo que vuelve al navegador se filtra según la visibilidad configurada.
 */
export function createAdminClient() {
  const { url } = supabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (solo servidor). Revisa .env.local.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
