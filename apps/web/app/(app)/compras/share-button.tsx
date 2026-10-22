"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** Comparte la lista como texto (WhatsApp, notas) o la copia si el navegador no permite compartir. */
export function ShareButton({ week }: { week: string }) {
  const [done, setDone] = useState<string | null>(null);
  async function share() {
    const res = await fetch(`/compras/exportar?semana=${encodeURIComponent(week)}`);
    if (!res.ok) {
      setDone("No se pudo exportar la lista");
      return;
    }
    const text = await res.text();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Lista de compras", text });
        setDone(null);
        return;
      }
      await navigator.clipboard.writeText(text);
      setDone("Lista copiada");
    } catch {
      // el usuario canceló el diálogo de compartir
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Button type="button" kind="quiet" onClick={share}>Compartir lista</Button>
      <a href={`/compras/exportar?semana=${encodeURIComponent(week)}&descargar=1`} className="text-sm text-tinta-suave underline-offset-2 hover:underline">Descargar</a>
      {done ? <span className="text-sm text-tinta-suave" role="status">{done}</span> : null}
    </div>
  );
}
