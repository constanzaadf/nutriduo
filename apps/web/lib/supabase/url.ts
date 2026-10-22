/**
 * Deja solo el origen de la URL de Supabase (https://xxxx.supabase.co).
 * Evita el error "Invalid path specified in request URL" cuando la variable se
 * copió con /rest/v1/, una barra final o espacios.
 */
export function supabaseOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}
