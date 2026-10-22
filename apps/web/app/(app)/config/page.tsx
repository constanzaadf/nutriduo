import type { Metadata } from "next";
import { DEFAULT_SLOT_SHARES, DEFAULT_EXCHANGE_TABLE } from "@nutriduo/nutrition-engine";
import { CONFIDENCE_LABEL_ES } from "@nutriduo/domain";
import { requireContext } from "@/lib/session";
import { kcal, macro } from "@/lib/format";
import { num, type GoalRow, type ProfileRow, type SlotTargetRow } from "@/lib/types";
import { Notice, PageHeader, Panel, SectionTitle, Tag, Button } from "@/components/ui";
import { ProfileForm } from "./profile-form";
import { GoalForms } from "./goal-forms";
import { addRestriction, regenerateInvite, removeRestriction, setVisibility } from "./actions";

export const metadata: Metadata = { title: "Configuración" };

const SEVERITY_LABEL: Record<string, string> = {
  allergy: "Alergia",
  prescribed_exclusion: "Excluido por indicación",
  intolerance: "Intolerancia",
  avoid: "Prefiero evitar",
};

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ bienvenida?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = ctx.supabase;
  const [{ data: profile }, { data: goal }, { data: restrictions }, { data: ingredients }, { data: grant }] = await Promise.all([
    db.from("nutrition_profiles").select("*").eq("id", ctx.me.profile_id).single(),
    db.from("nutrition_goals").select("*").eq("profile_id", ctx.me.profile_id).is("valid_to", null).maybeSingle(),
    db.from("dietary_restrictions").select("id, ingredient_id, tag, severity, ingredients(name)").eq("profile_id", ctx.me.profile_id),
    db.from("ingredients").select("id, name").order("name"),
    ctx.partner
      ? db.from("visibility_grants").select("level").eq("owner_profile_id", ctx.me.profile_id).eq("viewer_profile_id", ctx.partner.profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const g = goal as GoalRow | null;
  const { data: slotRows } = g ? await db.from("meal_slot_targets").select("slot, kcal_share, exchange_portions").eq("goal_id", g.id) : { data: [] };
  const slots = (slotRows ?? []) as SlotTargetRow[];
  const shares: Record<string, number> =
    slots.length > 0 ? Object.fromEntries(slots.map((s) => [s.slot, Math.round(num(s.kcal_share) * 100)])) : Object.fromEntries(Object.entries(DEFAULT_SLOT_SHARES).map(([k, v]) => [k, Math.round((v ?? 0) * 100)]));
  const exchangeBySlot = Object.fromEntries(slots.map((s) => [s.slot, s.exchange_portions ?? {}]));
  const myLevel = (grant as { level: string } | null)?.level ?? "private";

  return (
    <>
      <PageHeader title="Configuración" lead="Tu perfil y tus metas son tuyos: decide qué ve la otra persona del hogar." />
      {sp.bienvenida ? (
        <div className="mb-5">
          <Notice tone="ok">Listo, el hogar está creado. Completa tu perfil y guarda una meta: sin meta, el motor no puede calcular tus porciones.</Notice>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <Panel>
            <SectionTitle>Mi perfil</SectionTitle>
            <ProfileForm profile={profile as ProfileRow} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel>
            <SectionTitle aside={g ? <Tag tone={g.source === "prescribed" ? "ok" : "neutral"}>{CONFIDENCE_LABEL_ES[g.confidence]}</Tag> : null}>Meta vigente</SectionTitle>
            {g ? (
              <dl className="cifra grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div><dt className="text-tinta-suave">Energía</dt><dd className="text-lg font-semibold">{kcal(num(g.kcal), g.confidence)}</dd></div>
                <div><dt className="text-tinta-suave">Proteína</dt><dd className="text-lg font-semibold">{macro(num(g.protein_g), g.confidence)}</dd></div>
                <div><dt className="text-tinta-suave">Carbohidratos</dt><dd className="text-lg font-semibold">{macro(num(g.carbs_g), g.confidence)}</dd></div>
                <div><dt className="text-tinta-suave">Grasas</dt><dd className="text-lg font-semibold">{macro(num(g.fat_g), g.confidence)}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-tinta-suave">Aún no tienes meta. Calcúlala con tu perfil o carga la que te indicó tu profesional.</p>
            )}
            {g?.source === "prescribed" ? (
              <p className="mt-3 text-sm text-tinta-suave">
                Indicada{g.prescribed_by ? ` por ${g.prescribed_by}` : ""}{g.mode === "exchanges" ? ", por porciones de intercambio" : ""}. El motor la respeta y no la recalcula.
              </p>
            ) : null}
            <div className="mt-5">
              <GoalForms shares={shares} exchangeBySlot={exchangeBySlot} groups={Object.values(DEFAULT_EXCHANGE_TABLE).map((x) => ({ code: x.code, label: x.label }))} />
            </div>
          </Panel>

          <Panel>
            <SectionTitle>Alergias, restricciones y gustos</SectionTitle>
            <p className="mb-3 text-sm text-tinta-suave">
              Las alergias y exclusiones indicadas son restricciones duras: la app no deja asignarte una receta que las contenga. Las alergias las ve todo el hogar, porque sin eso no se puede cocinar con seguridad.
            </p>
            <ul className="mb-4 space-y-2">
              {(restrictions ?? []).map((r) => {
                const row = r as unknown as { id: string; tag: string | null; severity: string; ingredients: { name: string } | null };
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-avena px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{row.ingredients?.name ?? row.tag}</span>
                      <span className="text-tinta-suave"> ({SEVERITY_LABEL[row.severity].toLowerCase()})</span>
                    </span>
                    <form action={removeRestriction}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="text-tinta-suave hover:text-ladrillo" aria-label={`Quitar ${row.ingredients?.name ?? row.tag}`}>Quitar</button>
                    </form>
                  </li>
                );
              })}
            </ul>
            <form action={addRestriction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select name="severity" className="campo" defaultValue="allergy" aria-label="Tipo">
                {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select name="ingredient_id" className="campo" defaultValue="" aria-label="Ingrediente">
                  <option value="">Ingrediente…</option>
                  {(ingredients ?? []).map((i) => (
                    <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                  ))}
                </select>
                <input name="tag" className="campo" placeholder="o etiqueta: gluten" aria-label="Etiqueta" />
              </div>
              <Button kind="quiet">Agregar</Button>
            </form>
          </Panel>

          {ctx.partner ? (
            <Panel>
              <SectionTitle>Qué ve {ctx.partner.display_name}</SectionTitle>
              <form action={setVisibility} className="space-y-2">
                {[
                  ["private", "Nada", "Solo ve que compartimos una comida."],
                  ["summary", "Resumen", "Ve los gramos de mi porción en comidas compartidas, sin metas ni macros."],
                  ["full", "Todo", "Ve mis metas, macros, consumo y progreso."],
                ].map(([v, label, help]) => (
                  <label key={v} className="flex cursor-pointer items-start gap-3 rounded-xl border border-avena px-3 py-2.5 has-[:checked]:border-salvia has-[:checked]:bg-salvia-claro/50">
                    <input type="radio" name="level" value={v} defaultChecked={myLevel === v} className="mt-1 accent-[var(--color-salvia)]" />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-sm text-tinta-suave">{help}</span>
                    </span>
                  </label>
                ))}
                <Button kind="quiet">Guardar visibilidad</Button>
              </form>
            </Panel>
          ) : null}

          <Panel>
            <SectionTitle>Hogar</SectionTitle>
            <p className="text-sm">{ctx.household.name}, {ctx.people.length} de {ctx.household.max_members} integrantes.</p>
            {ctx.people.length < ctx.household.max_members ? (
              <div className="mt-3 rounded-xl bg-masa px-4 py-3">
                <p className="text-sm text-tinta-suave">Código para que tu pareja se una</p>
                <p className="cifra mt-1 font-display text-2xl font-semibold tracking-[0.2em]">{ctx.household.invite_code}</p>
              </div>
            ) : null}
            {ctx.role === "owner" ? (
              <form action={regenerateInvite} className="mt-3">
                <Button kind="ghost" className="px-0">Generar un código nuevo</Button>
              </form>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
