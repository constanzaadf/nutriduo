import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { signOut } from "../../login/actions";
import { MORE_ITEMS } from "../nav-items";

export default function MorePage() {
  return (
    <>
      <PageHeader title="Más" />
      <Panel className="divide-y divide-avena p-0 sm:p-0">
        {MORE_ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="block px-5 py-4 text-[1.05rem] hover:bg-avena/30">
            {i.label}
          </Link>
        ))}
      </Panel>
      <form action={signOut} className="mt-6">
        <button className="text-sm text-tinta-suave underline">Cerrar sesión</button>
      </form>
    </>
  );
}
