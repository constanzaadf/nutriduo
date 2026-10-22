import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Household, Person } from "./types";

export const ACTIVE_PROFILE_COOKIE = "nd_profile";

export interface AppContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  role: "owner" | "member";
  household: Household;
  people: Person[];
  me: Person;
  partner: Person | null;
  /** Perfil desde cuya perspectiva se ve la app (el propio por defecto). */
  active: Person;
}

/** Contexto de toda página privada: sesión, hogar, personas y perfil activo. */
export async function requireContext(): Promise<AppContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id)
    .order("joined_at")
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/onboarding");

  const { data: household, error } = await supabase
    .from("households")
    .select("id, name, timezone, currency, invite_code, max_members")
    .eq("id", membership.household_id)
    .single();
  if (error || !household) redirect("/onboarding");

  const { data: peopleData } = await supabase.rpc("household_people", { p_household: household.id });
  const people = (peopleData ?? []) as Person[];
  const me = people.find((p) => p.is_me);
  if (!me) redirect("/onboarding");

  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value;
  const active = people.find((p) => p.profile_id === activeId && (p.is_me || p.my_view_level !== "private")) ?? me;
  const partner = people.find((p) => p.profile_id !== me.profile_id) ?? null;

  return {
    supabase,
    userId: user.id,
    role: membership.role as "owner" | "member",
    household: household as Household,
    people,
    me,
    partner,
    active,
  };
}

export function personName(people: Person[], profileId: string): string {
  return people.find((p) => p.profile_id === profileId)?.display_name ?? "—";
}

/** Índice estable de color por persona (0 = primera en unirse). */
export function personTone(people: Person[], profileId: string): 0 | 1 {
  const i = people.findIndex((p) => p.profile_id === profileId);
  return i === 1 ? 1 : 0;
}
