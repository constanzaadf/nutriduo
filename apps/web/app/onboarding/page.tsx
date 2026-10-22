import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForms } from "./forms";

export const metadata: Metadata = { title: "Tu hogar" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: m } = await supabase.from("household_members").select("id").eq("user_id", user.id).limit(1).maybeSingle();
  if (m) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-[2.1rem] font-semibold">Armemos tu hogar</h1>
      <p className="mt-2 max-w-[60ch] text-tinta-suave">
        Una persona crea el hogar y comparte el código; la otra se une con él. Cada uno mantiene su perfil y sus metas, y solo
        comparte lo que decida.
      </p>
      <OnboardingForms />
    </main>
  );
}
