import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-5">
      <h1 className="text-3xl font-semibold">No encontramos esa página</h1>
      <p className="mt-2 text-tinta-suave">Puede que la comida o receta se haya eliminado, o que pertenezca a otro hogar.</p>
      <Link href="/dashboard" className="mt-6 font-semibold text-salvia-oscuro underline">Volver al inicio</Link>
    </main>
  );
}
