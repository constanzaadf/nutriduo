"use client";

import { useActionState, useState } from "react";
import { Submit } from "@/components/submit";
import { Notice, cx } from "@/components/ui";
import { previewGoals, saveCalculatedGoal, saveExchangeGoal, saveManualGoal, type FormState, type GoalPreviewState } from "./actions";

const SLOTS = [
  ["breakfast", "Desayuno"],
  ["snack_am", "Snack mañana"],
  ["lunch", "Almuerzo"],
  ["snack_pm", "Snack tarde"],
  ["dinner", "Cena"],
] as const;

function SharesFields({ shares }: { shares: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, number>>(Object.fromEntries(SLOTS.map(([s]) => [s, shares[s] ?? 0])));
  const total = Object.values(values).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return (
    <fieldset className="mt-4">
      <legend className="etiqueta">Reparto de la energía por tiempo de comida</legend>
      <div className="grid grid-cols-5 gap-2">
        {SLOTS.map(([s, label]) => (
          <label key={s} className="text-center text-xs text-tinta-suave">
            <input
              name={`share_${s}`}
              type="number"
              min={0}
              max={100}
              className="campo cifra px-2 text-center"
              value={values[s]}
              onChange={(e) => setValues((v) => ({ ...v, [s]: Number(e.target.value) }))}
            />
            <span className="mt-1 block">{label}</span>
          </label>
        ))}
      </div>
      <p className={cx("mt-1 text-xs", total === 100 ? "text-tinta-suave" : "text-ladrillo")}>Suma {total} %{total === 100 ? "" : ": debe ser 100 %"}</p>
    </fieldset>
  );
}

export function GoalForms({
  shares,
  exchangeBySlot,
  groups,
}: {
  shares: Record<string, number>;
  exchangeBySlot: Record<string, Record<string, number>>;
  groups: { code: string; label: string }[];
}) {
  const [tab, setTab] = useState<"calc" | "manual" | "exchanges">("calc");
  const [preview, previewAction] = useActionState<GoalPreviewState, FormData>(previewGoals, null);
  const [calcState, calcAction] = useActionState<FormState, FormData>(saveCalculatedGoal, null);
  const [manualState, manualAction] = useActionState<FormState, FormData>(saveManualGoal, null);
  const [exState, exAction] = useActionState<FormState, FormData>(saveExchangeGoal, null);

  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 rounded-full bg-masa p-1 text-sm">
        {[
          ["calc", "Calcular"],
          ["manual", "Meta indicada"],
          ["exchanges", "Pauta por porciones"],
        ].map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k as typeof tab)} className={cx("flex-1 rounded-full px-3 py-1.5", tab === k ? "bg-papel font-semibold shadow-[0_1px_0_var(--color-avena)]" : "text-tinta-suave")}>
            {l}
          </button>
        ))}
      </div>

      {tab === "calc" ? (
        <form action={calcAction}>
          <p className="text-sm text-tinta-suave">Mifflin-St Jeor con tu perfil guardado. El ejercicio se suma por MET y no se cuenta dos veces.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="etiqueta" htmlFor="kcal_adjust">Ajuste (%)</label>
              <input id="kcal_adjust" name="kcal_adjust" type="number" step={1} className="campo cifra" placeholder="según objetivo" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="bmr_method">Ecuación</label>
              <select id="bmr_method" name="bmr_method" className="campo">
                <option value="mifflin_st_jeor">Mifflin-St Jeor</option>
                <option value="katch_mcardle">Katch-McArdle (con % grasa)</option>
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="day_mode">Metas por día</label>
              <select id="day_mode" name="day_mode" className="campo">
                <option value="weekly_average">Promedio semanal</option>
                <option value="by_weekday">Distintas según entrenamiento</option>
              </select>
            </div>
          </div>
          <SharesFields shares={shares} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button formAction={previewAction} className="rounded-full border border-avena-fuerte bg-papel px-4 py-2.5 text-sm font-semibold">
              Ver cálculo
            </button>
            <Submit>Guardar como meta vigente</Submit>
          </div>
          {preview?.ok === false ? <div className="mt-3"><Notice tone="error">{preview.message}</Notice></div> : null}
          {preview?.ok ? (
            <div className="mt-4 rounded-xl bg-masa p-4 text-sm">
              <dl className="cifra grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div><dt className="text-tinta-suave">Basal</dt><dd className="font-semibold">{Math.round(preview.result.bmr)} kcal</dd></div>
                <div><dt className="text-tinta-suave">Gasto total</dt><dd className="font-semibold">{Math.round(preview.result.tdee)} kcal</dd></div>
                <div><dt className="text-tinta-suave">Ajuste aplicado</dt><dd className="font-semibold">{Math.round(preview.result.appliedAdjust * 100)} %</dd></div>
                <div><dt className="text-tinta-suave">Meta</dt><dd className="text-base font-semibold">{Math.round(preview.result.target.kcal / 10) * 10} kcal</dd></div>
                <div><dt className="text-tinta-suave">Proteína</dt><dd className="font-semibold">{Math.round(preview.result.target.protein_g)} g</dd></div>
                <div><dt className="text-tinta-suave">Carbohidratos / grasas</dt><dd className="font-semibold">{Math.round(preview.result.target.carbs_g)} g / {Math.round(preview.result.target.fat_g)} g</dd></div>
              </dl>
              {preview.result.warnings.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-tinta-suave">
                  {preview.result.warnings.map((w) => <li key={w.code}>{w.message}</li>)}
                </ul>
              ) : null}
              <p className="mt-3 text-xs text-tinta-suave">Es una estimación. Si tienes metas de un profesional, cárgalas en “Meta indicada”: mandan sobre este cálculo.</p>
            </div>
          ) : null}
          {calcState ? <div className="mt-3"><Notice tone={calcState.ok ? "ok" : "error"}>{calcState.message}</Notice></div> : null}
        </form>
      ) : null}

      {tab === "manual" ? (
        <form action={manualAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="by">Quién la indica</label>
              <select id="by" name="by" className="campo">
                <option value="professional">Mi nutricionista u otro profesional</option>
                <option value="self">Yo</option>
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="prescribed_by">Nombre del profesional (opcional)</label>
              <input id="prescribed_by" name="prescribed_by" className="campo" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["kcal", "kcal"],
              ["protein_g", "Proteína (g)"],
              ["carbs_g", "Carbohidratos (g)"],
              ["fat_g", "Grasas (g)"],
            ].map(([n, l]) => (
              <div key={n}>
                <label className="etiqueta" htmlFor={n}>{l}</label>
                <input id={n} name={n} inputMode="decimal" className="campo cifra" required />
              </div>
            ))}
          </div>
          <SharesFields shares={shares} />
          <div className="mt-4"><Submit>Guardar meta indicada</Submit></div>
          {manualState ? <div className="mt-3"><Notice tone={manualState.ok ? "ok" : "error"}>{manualState.message}</Notice></div> : null}
        </form>
      ) : null}

      {tab === "exchanges" ? (
        <form action={exAction}>
          <p className="text-sm text-tinta-suave">
            Copia las porciones de tu pauta por tiempo de comida. Las porciones se convierten a macros con la tabla de intercambios (editable): el motor intentará calzar cada plato con ±0,25 porciones por grupo.
          </p>
          <div className="mt-3">
            <label className="etiqueta" htmlFor="prescribed_by_ex">Profesional (opcional)</label>
            <input id="prescribed_by_ex" name="prescribed_by" className="campo" />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="cifra w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-tinta-suave">
                  <th className="py-1 pr-2 font-medium">Grupo</th>
                  {SLOTS.map(([s, l]) => <th key={s} className="px-1 py-1 text-center font-medium">{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.code} className="border-t border-avena">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">{g.label}</th>
                    {SLOTS.map(([s]) => (
                      <td key={s} className="px-1 py-1">
                        <input name={`ex_${s}_${g.code}`} inputMode="decimal" aria-label={`${g.label}, ${s}`} defaultValue={exchangeBySlot[s]?.[g.code] ?? ""} className="w-full rounded-lg border border-avena bg-papel px-1 py-1 text-center" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4"><Submit>Guardar pauta</Submit></div>
          {exState ? <div className="mt-3"><Notice tone={exState.ok ? "ok" : "error"}>{exState.message}</Notice></div> : null}
        </form>
      ) : null}
    </div>
  );
}
