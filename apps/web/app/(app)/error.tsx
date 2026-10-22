"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const config = /SUPABASE|\.env/.test(error.message);
  return (
    <div className="mx-auto max-w-lg py-10">
      <h1 className="text-2xl font-semibold">No se pudo cargar esta sección</h1>
      <p className="mt-2 text-tinta-suave">{config ? error.message : "Ocurrió un error al leer los datos. Si se repite, revisa la conexión con Supabase."}</p>
      <button onClick={reset} className="mt-5 rounded-full bg-salvia px-4 py-2.5 text-sm font-semibold text-papel">Reintentar</button>
    </div>
  );
}
