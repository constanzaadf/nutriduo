"use client";

import { useActionState, useState } from "react";
import { Submit } from "@/components/submit";
import { Button, Notice } from "@/components/ui";
import type { ProfileRow } from "@/lib/types";
import { saveProfile, type FormState } from "./actions";

const DAYS = ["D", "L", "M", "M", "J", "V", "S"];
const ACTIVITY_PRESETS = [
  { label: "Caminata rápida", met: 4.3 },
  { label: "Trote suave", met: 7 },
  { label: "Running 10 km/h", met: 9.8 },
  { label: "Bicicleta moderada", met: 6.8 },
  { label: "Natación", met: 6 },
  { label: "Pesas moderadas", met: 3.5 },
  { label: "Pesas intensas", met: 6 },
  { label: "Funcional / HIIT", met: 8 },
  { label: "Yoga", met: 2.5 },
];

type Session = { label: string; met: number; minutes: number; daysOfWeek: number[]; resistance?: boolean };

export function ProfileForm({ profile }: { profile: ProfileRow }) {
  const [state, action] = useActionState<FormState, FormData>(saveProfile, null);
  const [sessions, setSessions] = useState<Session[]>(profile.training ?? []);
  const update = (i: number, patch: Partial<Session>) => setSessions((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="training" value={JSON.stringify(sessions)} />
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Datos básicos</legend>
        <div>
          <label className="etiqueta" htmlFor="display_name">Nombre</label>
          <input id="display_name" name="display_name" className="campo" defaultValue={profile.display_name} required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="birth_date">Fecha de nacimiento</label>
          <input id="birth_date" name="birth_date" type="date" className="campo" defaultValue={profile.birth_date ?? ""} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="equation_constant">Constante de la ecuación metabólica</label>
          <select id="equation_constant" name="equation_constant" className="campo" defaultValue={profile.equation_constant ?? ""}>
            <option value="">Elegir…</option>
            <option value="female">Femenina (−161)</option>
            <option value="male">Masculina (+5)</option>
            <option value="average">Promedio de ambas (aproximado)</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor="height_cm">Estatura (cm)</label>
            <input id="height_cm" name="height_cm" inputMode="decimal" className="campo cifra" defaultValue={profile.height_cm ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="weight_kg">Peso (kg)</label>
            <input id="weight_kg" name="weight_kg" inputMode="decimal" className="campo cifra" defaultValue={profile.weight_kg ?? ""} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor="target_weight_kg">Peso objetivo (opcional)</label>
            <input id="target_weight_kg" name="target_weight_kg" inputMode="decimal" className="campo cifra" defaultValue={profile.target_weight_kg ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="body_fat_pct">% de grasa (opcional)</label>
            <input id="body_fat_pct" name="body_fat_pct" inputMode="decimal" className="campo cifra" defaultValue={profile.body_fat_pct ?? ""} />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Actividad</legend>
        <div>
          <label className="etiqueta" htmlFor="daily_activity">Día a día, sin contar entrenamientos</label>
          <select id="daily_activity" name="daily_activity" className="campo" defaultValue={profile.daily_activity ?? ""}>
            <option value="">Elegir…</option>
            <option value="sedentary">Sedentario: casi todo el día sentado</option>
            <option value="office_walking">Oficina, con algo de caminata</option>
            <option value="standing">De pie buena parte del día</option>
            <option value="physical">Trabajo físico</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="work_type">Tipo de trabajo (opcional)</label>
          <input id="work_type" name="work_type" className="campo" defaultValue={profile.work_type ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <p className="etiqueta">Entrenamientos semanales</p>
          <ul className="space-y-2">
            {sessions.map((s, i) => (
              <li key={i} className="grid gap-2 rounded-xl border border-avena p-3 sm:grid-cols-[1.4fr_0.7fr_auto]">
                <select
                  className="campo"
                  aria-label="Actividad"
                  value={ACTIVITY_PRESETS.find((p) => p.label === s.label) ? s.label : ""}
                  onChange={(e) => {
                    const p = ACTIVITY_PRESETS.find((x) => x.label === e.target.value);
                    if (p) update(i, { label: p.label, met: p.met, resistance: p.label.startsWith("Pesas") });
                  }}
                >
                  <option value="" disabled>{s.label || "Elegir actividad"}</option>
                  {ACTIVITY_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>{p.label} (MET {String(p.met).replace(".", ",")})</option>
                  ))}
                </select>
                <input className="campo cifra" type="number" min={5} max={600} aria-label="Minutos por sesión" value={s.minutes} onChange={(e) => update(i, { minutes: Number(e.target.value) })} />
                <button type="button" className="text-sm text-tinta-suave hover:text-ladrillo" onClick={() => setSessions((x) => x.filter((_, j) => j !== i))}>Quitar</button>
                <div className="flex gap-1 sm:col-span-3" role="group" aria-label="Días">
                  {DAYS.map((d, day) => {
                    const on = s.daysOfWeek.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update(i, { daysOfWeek: on ? s.daysOfWeek.filter((x) => x !== day) : [...s.daysOfWeek, day].sort() })}
                        className={`h-8 w-8 rounded-full text-sm ${on ? "bg-salvia text-papel" : "border border-avena text-tinta-suave"}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                  <span className="ml-auto self-center text-xs text-tinta-suave">minutos por sesión</span>
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" kind="ghost" className="mt-2 px-2" onClick={() => setSessions((s) => [...s, { label: "Caminata rápida", met: 4.3, minutes: 45, daysOfWeek: [] }])}>
            Agregar entrenamiento
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Objetivo</legend>
        <div>
          <label className="etiqueta" htmlFor="goal_type">Objetivo principal</label>
          <select id="goal_type" name="goal_type" className="campo" defaultValue={profile.goal_type ?? ""}>
            <option value="">Elegir…</option>
            <option value="fat_loss">Pérdida de grasa</option>
            <option value="recomposition">Recomposición corporal</option>
            <option value="muscle_gain">Ganancia muscular</option>
            <option value="maintenance">Mantención</option>
            <option value="balanced">Alimentación equilibrada</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="goal_note">Nota sobre tu objetivo</label>
          <input id="goal_note" name="goal_note" className="campo" defaultValue={profile.goal_note ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <p className="etiqueta">Situaciones que requieren indicación profesional</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {[
              ["pregnancy", "Embarazo"],
              ["lactation", "Lactancia"],
              ["medical_condition", "Condición médica en tratamiento"],
            ].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="checkbox" name="clinical_flags" value={v} defaultChecked={profile.clinical_flags?.includes(v!)} className="accent-[var(--color-salvia)]" />
                {l}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-tinta-suave">Si marcas alguna, la app no aplica déficit ni superávit automático: usa la meta que te indique tu profesional.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="professional_notes">Indicaciones de tu nutricionista</label>
          <textarea id="professional_notes" name="professional_notes" rows={3} className="campo" defaultValue={profile.professional_notes ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="cooking_preferences">Preferencias de cocina</label>
          <textarea id="cooking_preferences" name="cooking_preferences" rows={2} className="campo" defaultValue={profile.cooking_preferences ?? ""} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Submit>Guardar perfil</Submit>
        {state ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
      </div>
    </form>
  );
}
