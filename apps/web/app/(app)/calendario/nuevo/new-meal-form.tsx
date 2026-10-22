"use client";

import { useActionState, useState } from "react";
import { Submit } from "@/components/submit";
import { Button, Notice, cx } from "@/components/ui";
import { createMeal, type MealFormState } from "../actions";

export interface RecipeOption {
  id: string;
  name: string;
  versionId: string;
  defaultSlot: string;
  sides: { id: string; name: string }[];
}

type Extra = { ingredient_id: string; grams: number; state: "raw" | "cooked" | "as_sold"; integer_unit_g: number | null };

const SLOTS = [
  ["breakfast", "Desayuno"],
  ["snack_am", "Snack mañana"],
  ["lunch", "Almuerzo"],
  ["snack_pm", "Snack tarde"],
  ["dinner", "Cena"],
  ["extra", "Adicional"],
] as const;

const MODES = [
  ["A", "Compartida", "Los dos comen lo mismo, cada uno con su porción."],
  ["C", "Compartida con ajustes", "Misma base; cada uno agrega u omite acompañamientos."],
  ["B", "Individual", "Una persona; la otra puede tener su propia comida."],
] as const;

export function NewMealForm({
  people,
  recipes,
  ingredients,
  batches,
  initial,
}: {
  people: { id: string; name: string; tone: 0 | 1; isMe: boolean }[];
  recipes: RecipeOption[];
  ingredients: { id: string; name: string; state: "raw" | "cooked" | "as_sold"; unit: number | null }[];
  batches: { id: string; versionId: string; label: string }[];
  initial: { date: string; slot: string | null; recipeId: string | null };
}) {
  const [state, action] = useActionState<MealFormState, FormData>(createMeal, null);
  const [mode, setMode] = useState<"A" | "B" | "C">(people.length > 1 ? "A" : "B");
  const [recipeId, setRecipeId] = useState(initial.recipeId ?? recipes[0]!.id);
  const recipe = recipes.find((r) => r.id === recipeId) ?? recipes[0]!;
  const [slot, setSlot] = useState(initial.slot ?? recipe.defaultSlot);
  const [single, setSingle] = useState(people.find((p) => p.isMe)?.id ?? people[0]!.id);
  const [opts, setOpts] = useState<Record<string, { extras: Extra[]; skip_sides: string[] }>>(Object.fromEntries(people.map((p) => [p.id, { extras: [], skip_sides: [] }])));
  const batchesForRecipe = batches.filter((b) => b.versionId === recipe.versionId);
  const participants = mode === "B" ? [single] : people.map((p) => p.id);
  const patch = (pid: string, fn: (o: { extras: Extra[]; skip_sides: string[] }) => { extras: Extra[]; skip_sides: string[] }) => setOpts((x) => ({ ...x, [pid]: fn(x[pid]!) }));

  return (
    <form action={action} className="space-y-6">
      {participants.map((p) => <input key={p} type="hidden" name="participants" value={p} />)}
      <input type="hidden" name="options" value={JSON.stringify(mode === "C" ? Object.fromEntries(Object.entries(opts).map(([k, o]) => [k, { ...o, extras: o.extras.filter((e) => e.ingredient_id) }])) : {})} />

      <fieldset>
        <legend className="etiqueta">Modalidad</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.filter(([m]) => people.length > 1 || m === "B").map(([m, label, help]) => (
            <label key={m} className={cx("cursor-pointer rounded-2xl border p-3", mode === m ? "border-salvia bg-salvia-claro/50" : "border-avena")}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              <span className="flex items-center gap-2 font-semibold">
                <ModeGlyph mode={m} />
                {label}
              </span>
              <span className="mt-1 block text-sm text-tinta-suave">{help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className="etiqueta" htmlFor="recipe_id">Receta</label>
          <select id="recipe_id" name="recipe_id" className="campo" value={recipeId} onChange={(e) => { setRecipeId(e.target.value); const r = recipes.find((x) => x.id === e.target.value); if (r && !initial.slot) setSlot(r.defaultSlot); }}>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="date">Día</label>
          <input id="date" name="date" type="date" className="campo" defaultValue={initial.date} required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="slot">Tiempo de comida</label>
          <select id="slot" name="slot" className="campo" value={slot} onChange={(e) => setSlot(e.target.value)}>
            {SLOTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {mode === "B" ? (
          <div>
            <label className="etiqueta" htmlFor="single">Para</label>
            <select id="single" className="campo" value={single} onChange={(e) => setSingle(e.target.value)}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ) : null}
      </div>

      {mode === "C" ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="etiqueta">Ajustes de cada uno</legend>
          {people.map((p) => {
            const o = opts[p.id]!;
            return (
              <div key={p.id} className={cx(`tono-${p.tone}`, "rounded-2xl border-t-4 border-[var(--tono)] bg-[var(--tono-claro)]/50 p-3")}>
                <p className="font-semibold">{p.name}</p>
                {recipe.sides.length ? (
                  <div className="mt-2 space-y-1 text-sm">
                    {recipe.sides.map((s) => (
                      <label key={s.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--tono)]"
                          checked={!o.skip_sides.includes(s.id)}
                          onChange={(e) => patch(p.id, (x) => ({ ...x, skip_sides: e.target.checked ? x.skip_sides.filter((i) => i !== s.id) : [...x.skip_sides, s.id] }))}
                        />
                        Con {s.name.toLowerCase()}
                      </label>
                    ))}
                  </div>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {o.extras.map((ex, i) => (
                    <li key={i} className="grid grid-cols-[1fr_5rem_auto] gap-1">
                      <select
                        className="campo px-2 py-1.5 text-sm"
                        aria-label="Acompañamiento"
                        value={ex.ingredient_id}
                        onChange={(e) => {
                          const ing = ingredients.find((x) => x.id === e.target.value);
                          patch(p.id, (x) => ({ ...x, extras: x.extras.map((y, j) => (j === i ? { ...y, ingredient_id: e.target.value, state: ing?.state ?? "raw", integer_unit_g: ing?.unit ?? null, grams: ing?.unit ?? y.grams } : y)) }));
                        }}
                      >
                        <option value="">Elegir…</option>
                        {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <input type="number" min={1} aria-label="Gramos" className="campo cifra px-2 py-1.5 text-sm" value={ex.grams} onChange={(e) => patch(p.id, (x) => ({ ...x, extras: x.extras.map((y, j) => (j === i ? { ...y, grams: Number(e.target.value) } : y)) }))} />
                      <button type="button" className="px-1 text-sm text-tinta-suave" aria-label="Quitar" onClick={() => patch(p.id, (x) => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }))}>×</button>
                    </li>
                  ))}
                </ul>
                <Button type="button" kind="ghost" className="mt-1 px-1 text-sm" onClick={() => patch(p.id, (x) => ({ ...x, extras: [...x.extras, { ingredient_id: "", grams: 60, state: "as_sold", integer_unit_g: null }] }))}>
                  Agregar acompañamiento propio
                </Button>
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <details className="rounded-xl border border-avena px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Lote y cantidad a cocinar</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="etiqueta">Sale de un lote ya cocinado</span>
            <select name="batch_id" className="campo" defaultValue="">
              <option value="">No, se cocina para esta comida</option>
              {batchesForRecipe.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="etiqueta">Cocinar porciones de la receta (para que sobre)</span>
            <input name="cook_servings" type="number" min={1} step={0.5} className="campo cifra" placeholder="lo justo" />
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pendingLabel="Calculando porciones…">Guardar y calcular porciones</Submit>
        {state && !state.ok ? <Notice tone="error">{state.message}</Notice> : null}
      </div>
    </form>
  );
}

function ModeGlyph({ mode }: { mode: "A" | "B" | "C" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={mode === "B" ? "3 2.5" : undefined} />
      {mode !== "B" ? <path d="M12 3v18" stroke="currentColor" strokeWidth="1.5" /> : null}
      {mode === "C" ? <circle cx="18.5" cy="18.5" r="3" fill="var(--color-ciruela)" /> : null}
    </svg>
  );
}
