"use client";

import { useActionState, useMemo, useState } from "react";
import { Submit } from "@/components/submit";
import { Button, Notice, cx } from "@/components/ui";
import { saveRecipe, type RecipeState } from "./actions";

export interface EditorIngredient {
  id: string;
  name: string;
  default_state: "raw" | "cooked" | "as_sold";
  states: ("raw" | "cooked" | "as_sold")[];
  per100: Partial<Record<"raw" | "cooked" | "as_sold", { kcal: number; protein_g: number; carbs_g: number; fat_g: number }>>;
  unit_weight_g: number | null;
}

export interface EditorLine {
  ingredient_id: string;
  grams: number;
  state: "raw" | "cooked" | "as_sold";
  role: "fixed" | "adjustable" | "ratio" | "side";
  min_g: number | null;
  max_g: number | null;
  ratio_group: string | null;
  integer_unit_g: number | null;
}

export interface EditorInitial {
  recipeId: string | null;
  parentVersionId: string | null;
  name: string;
  category: string;
  tags: string[];
  prep_minutes: number | null;
  servings_nominal: number;
  is_homogeneous: boolean;
  expected_cooked_yield_g: number | null;
  instructions: string;
  lines: EditorLine[];
}

const ROLE_HELP: Record<EditorLine["role"], string> = {
  adjustable: "Se ajusta",
  side: "Acompañamiento",
  ratio: "En proporción",
  fixed: "Fijo",
};

const emptyLine = (): EditorLine => ({ ingredient_id: "", grams: 100, state: "raw", role: "adjustable", min_g: null, max_g: null, ratio_group: null, integer_unit_g: null });

export function RecipeEditor({ initial, ingredients, isNewVersion }: { initial: EditorInitial; ingredients: EditorIngredient[]; isNewVersion: boolean }) {
  const [state, action] = useActionState<RecipeState, FormData>(saveRecipe, null);
  const [r, setR] = useState(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [change, setChange] = useState("");
  const [why, setWhy] = useState("");
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const setLine = (i: number, patch: Partial<EditorLine>) => setR((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  // Vista previa por porción nominal (la evaluación formal la hace el servidor)
  const preview = r.lines.reduce(
    (acc, l) => {
      const p = byId.get(l.ingredient_id)?.per100[l.state];
      if (!p) return { ...acc, missing: acc.missing + (l.ingredient_id ? 1 : 0) };
      const f = l.grams / 100;
      return { ...acc, kcal: acc.kcal + p.kcal * f, protein_g: acc.protein_g + p.protein_g * f, carbs_g: acc.carbs_g + p.carbs_g * f, fat_g: acc.fat_g + p.fat_g * f };
    },
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, missing: 0 },
  );

  const payload = {
    recipeId: r.recipeId,
    parentVersionId: r.parentVersionId,
    name: r.name,
    category: r.category,
    tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
    prep_minutes: r.prep_minutes,
    servings_nominal: r.servings_nominal,
    is_homogeneous: r.is_homogeneous,
    expected_cooked_yield_g: r.expected_cooked_yield_g,
    instructions: r.instructions || null,
    change: isNewVersion ? change || null : null,
    why: isNewVersion ? why || null : null,
    lines: r.lines,
  };

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="rname">Nombre</label>
          <input id="rname" className="campo" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="rcat">Categoría</label>
          <select id="rcat" className="campo" value={r.category} onChange={(e) => setR({ ...r, category: e.target.value })}>
            <option value="desayunos">Desayunos</option>
            <option value="almuerzos">Almuerzos</option>
            <option value="cenas">Cenas</option>
            <option value="snacks">Snacks</option>
            <option value="postres">Postres</option>
            <option value="preparaciones_base">Preparaciones base</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="rtags">Etiquetas</label>
          <input id="rtags" className="campo" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="alta en proteínas, rápida, congelable" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor="rserv">Porciones que rinde</label>
            <input id="rserv" type="number" min={0.5} step={0.5} className="campo cifra" value={r.servings_nominal} onChange={(e) => setR({ ...r, servings_nominal: Number(e.target.value) })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="rmin">Minutos</label>
            <input id="rmin" type="number" min={0} className="campo cifra" value={r.prep_minutes ?? ""} onChange={(e) => setR({ ...r, prep_minutes: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </div>
        <div className="rounded-xl border border-avena p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-[var(--color-salvia)]" checked={r.is_homogeneous} onChange={(e) => setR({ ...r, is_homogeneous: e.target.checked })} />
            <span>
              <span className="font-medium">Es una mezcla que no se separa al cocinar</span>
              <span className="block text-tinta-suave">Guisos, salsas, sopas. Se reparte en gramos de preparación terminada; los acompañamientos van aparte.</span>
            </span>
          </label>
          {r.is_homogeneous ? (
            <label className="mt-2 block text-xs text-tinta-suave">
              Peso cocido esperado de toda la receta (g, opcional)
              <input type="number" min={1} className="campo cifra mt-1" value={r.expected_cooked_yield_g ?? ""} onChange={(e) => setR({ ...r, expected_cooked_yield_g: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
          ) : null}
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 font-display text-lg font-semibold">Ingredientes por porción</legend>
        <p className="mb-3 text-sm text-tinta-suave">
          Gramos de UNA porción, en el estado en que los pesas. “Se ajusta” lo puede mover el motor; “Acompañamiento” se cocina aparte y cada persona puede omitirlo; “En proporción” se mueve en bloque con su grupo (una salsa); “Fijo” no cambia.
        </p>
        <ul className="space-y-2">
          {r.lines.map((l, i) => {
            const ing = byId.get(l.ingredient_id);
            const noData = ing && !ing.per100[l.state];
            return (
              <li key={i} className={cx("rounded-xl border p-3", noData ? "border-miel/60" : "border-avena")}>
                <div className="grid gap-2 sm:grid-cols-[1.6fr_0.6fr_0.8fr_0.9fr_auto]">
                  <select
                    className="campo"
                    aria-label="Ingrediente"
                    value={l.ingredient_id}
                    onChange={(e) => {
                      const sel = byId.get(e.target.value);
                      setLine(i, { ingredient_id: e.target.value, state: sel?.states[0] ?? sel?.default_state ?? "raw" });
                    }}
                  >
                    <option value="">Elegir ingrediente…</option>
                    {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <input type="number" min={0.1} step="any" aria-label="Gramos" className="campo cifra" value={l.grams} onChange={(e) => setLine(i, { grams: Number(e.target.value) })} />
                  <select className="campo" aria-label="Estado" value={l.state} onChange={(e) => setLine(i, { state: e.target.value as EditorLine["state"] })}>
                    <option value="raw">crudo</option>
                    <option value="cooked">cocido</option>
                    <option value="as_sold">como se vende</option>
                  </select>
                  <select className="campo" aria-label="Rol" value={l.role} onChange={(e) => setLine(i, { role: e.target.value as EditorLine["role"] })}>
                    {Object.entries(ROLE_HELP).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <button type="button" className="text-sm text-tinta-suave hover:text-ladrillo" onClick={() => setR((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>Quitar</button>
                </div>
                {noData ? <p className="mt-2 text-xs text-miel">Este ingrediente no tiene datos en estado {l.state === "raw" ? "crudo" : l.state === "cooked" ? "cocido" : "como se vende"}: cámbialo o agrega esa fila en Ingredientes.</p> : null}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-tinta-suave">Límites y unidades</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-xs text-tinta-suave">Mínimo (g)<input type="number" className="campo cifra mt-1" value={l.min_g ?? ""} onChange={(e) => setLine(i, { min_g: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                    <label className="text-xs text-tinta-suave">Máximo (g)<input type="number" className="campo cifra mt-1" value={l.max_g ?? ""} onChange={(e) => setLine(i, { max_g: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                    <label className="text-xs text-tinta-suave">
                      Se porciona en unidades de (g)
                      <input type="number" className="campo cifra mt-1" placeholder={ing?.unit_weight_g ? String(ing.unit_weight_g) : ""} value={l.integer_unit_g ?? ""} onChange={(e) => setLine(i, { integer_unit_g: e.target.value === "" ? null : Number(e.target.value) })} />
                    </label>
                    {l.role === "ratio" ? (
                      <label className="text-xs text-tinta-suave">Grupo<input className="campo mt-1" value={l.ratio_group ?? ""} onChange={(e) => setLine(i, { ratio_group: e.target.value })} placeholder="salsa" /></label>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <Button type="button" kind="ghost" className="mt-2 px-2" onClick={() => setR((x) => ({ ...x, lines: [...x.lines, emptyLine()] }))}>
          Agregar ingrediente
        </Button>
        <p className="cifra mt-3 text-sm text-tinta-suave">
          Porción nominal: {Math.round(preview.kcal)} kcal, P {Math.round(preview.protein_g)} g, C {Math.round(preview.carbs_g)} g, G {Math.round(preview.fat_g)} g
          {preview.missing > 0 ? ` (faltan datos de ${preview.missing})` : ""}
        </p>
      </fieldset>

      <div>
        <label className="etiqueta" htmlFor="rinst">Preparación</label>
        <textarea id="rinst" rows={5} className="campo" value={r.instructions} onChange={(e) => setR({ ...r, instructions: e.target.value })} />
      </div>

      {isNewVersion ? (
        <fieldset className="grid gap-3 rounded-xl bg-masa p-4 sm:grid-cols-2">
          <legend className="sr-only">Cambios de esta versión</legend>
          <p className="text-sm text-tinta-suave sm:col-span-2">Se guarda como versión nueva: la anterior queda intacta y se puede volver a ella.</p>
          <label className="text-sm">Qué cambió<input className="campo mt-1" value={change} onChange={(e) => setChange(e.target.value)} placeholder="Menos aceite, más pollo" /></label>
          <label className="text-sm">Por qué<input className="campo mt-1" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Subir proteína sin cambiar el plato" /></label>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Submit>{isNewVersion ? "Guardar versión nueva" : "Guardar receta"}</Submit>
        {state && !state.ok ? <Notice tone="error">{state.message}</Notice> : null}
      </div>
    </form>
  );
}
