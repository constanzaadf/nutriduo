"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_PROFILE_COOKIE, requireContext } from "@/lib/session";

export async function setActiveProfile(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("profileId") ?? "");
  const target = ctx.people.find((p) => p.profile_id === id);
  // Solo se puede mirar desde la perspectiva de alguien que comparte al menos un resumen.
  if (!target || (!target.is_me && target.my_view_level === "private")) return;
  const store = await cookies();
  store.set(ACTIVE_PROFILE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 180 });
  revalidatePath("/", "layout");
}
