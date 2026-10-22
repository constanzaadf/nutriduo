"use client";

import { useActionState } from "react";
import { Submit } from "@/components/submit";
import { Notice } from "@/components/ui";
import { createIngredient, type IngredientState } from "./actions";

const CATEGORIES = [
  ["carnes", "Carnes"], ["pescados", "Pescados"], ["huevos", "Huevos"], ["lacteos", "Lácteos"], ["cereales", "Cereales y pastas"],
  ["legumbres", "Legumbres"], ["verduras", "Verduras"], ["frutas", "Frutas"], ["grasas", "Aceites y grasas"], ["frutos_secos", "Frutos secos"],
  ["condimentos", "Condimentos"], ["panaderia", "Panadería"], ["bebidas", "Bebidas"], ["otros", "Otros"],
];
const GROUPS = [
  ["cereales", "Cereales"], ["verduras_general", "Verduras consumo general"], ["verduras_libre", "Verduras libre consumo"], ["frutas", "Frutas"],
  ["carnes_altas_grasa", "Carnes altas en grasa"], ["carnes_bajas_grasa", "Carnes bajas en grasa"], ["legumbres", "Leguminosas"],
  ["lacteos_altos_grasa", "Lácteos altos en grasa"], ["lacteos_medios_grasa", "Lácteos medios en grasa"], ["lacteos_bajos_grasa", "Lácteos bajos en grasa"],
  ["aceites_grasas", "Aceites y grasas"], ["alimentos_ricos_lipidos", "Ricos en lípidos"], ["azucares", "Azúcares"],
];

export function IngredientForm() {
  const [state, action] = useActionState<IngredientState, FormData>(createIngredient, null);
  return (
    <form action={action} className="space-y-3" key={state?.ok ? state.message : "form"}>
      <div>
        <label className="etiqueta" htmlFor="name">Nombre</label>
        <input id="name" name="name" className="campo" required placeholder="Pechuga de pollo" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="etiqueta" htmlFor="category">Categoría</label>
          <select id="category" name="category" className="campo" defaultValue="otros">
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="state">Los valores son de</label>
          <select id="state" name="state" className="campo" defaultValue="as_sold">
            <option value="as_sold">Como se vende</option>
            <option value="raw">Crudo</option>
            <option value="cooked">Cocido</option>
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="etiqueta">Por cada 100 g</legend>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["kcal", "kcal"], ["protein_g", "Proteínas"], ["carbs_g", "Carbohidratos"], ["fat_g", "Grasas"], ["fiber_g", "Fibra"], ["sodium_mg", "Sodio (mg)"],
          ].map(([nm, l]) => (
            <label key={nm} className="text-xs text-tinta-suave">
              {l}
              <input name={nm} inputMode="decimal" className="campo cifra mt-1" required={["kcal", "protein_g", "carbs_g", "fat_g"].includes(nm!)} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="etiqueta" htmlFor="source">Fuente</label>
          <select id="source" name="source" className="campo" defaultValue="label">
            <option value="label">Etiqueta del envase</option>
            <option value="fdc">USDA FoodData Central</option>
            <option value="manual">Otra (queda como estimado)</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="source_ref">Referencia</label>
          <input id="source_ref" name="source_ref" className="campo" placeholder="marca o ID FDC" />
        </div>
      </div>
      <details className="rounded-xl border border-avena px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Más datos (rendimiento, unidades, intercambio, alérgenos, envase)</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-tinta-suave">
              Peso de 1 unidad (g)
              <input name="unit_weight_g" inputMode="decimal" className="campo cifra mt-1" placeholder="huevo ≈ 55" />
            </label>
            <label className="text-xs text-tinta-suave">
              Rendimiento al cocinar (×)
              <input name="yield_factor" inputMode="decimal" className="campo cifra mt-1" placeholder="arroz ≈ 2,5" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-tinta-suave">
              Grupo de intercambio
              <select name="exchange_group_code" className="campo mt-1" defaultValue="">
                <option value="">Ninguno</option>
                {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs text-tinta-suave">
              Gramos por porción
              <input name="exchange_grams" inputMode="decimal" className="campo cifra mt-1" />
            </label>
          </div>
          <label className="block text-xs text-tinta-suave">
            Alérgenos (separados por coma)
            <input name="allergen_tags" className="campo mt-1" placeholder="gluten, lactosa, mani" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-tinta-suave">
              Envase habitual (g)
              <input name="pack_grams" inputMode="decimal" className="campo cifra mt-1" placeholder="800" />
            </label>
            <label className="text-xs text-tinta-suave">
              Precio del envase
              <input name="pack_price" inputMode="decimal" className="campo cifra mt-1" />
            </label>
          </div>
        </div>
      </details>
      <Submit>Agregar ingrediente</Submit>
      {state ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
    </form>
  );
}
