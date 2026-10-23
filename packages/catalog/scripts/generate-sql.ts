/**
 * Genera la migración de datos del catálogo (ingredientes, nutrición,
 * rendimientos y recetario base) y el archivo para pegar en el SQL Editor.
 *
 *   pnpm catalog:generate
 *
 * Es idempotente: se puede ejecutar varias veces; actualiza lo existente y
 * agrega a cada hogar las recetas del catálogo que le falten.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_RECIPES, SR28, buildCatalog, recipeTags } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const q = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Número inválido: ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const arr = (xs: string[]) => (xs.length ? `array[${xs.map(q).join(", ")}]::text[]` : "'{}'::text[]");

const catalog = buildCatalog();
const parts: string[] = [];
parts.push(`-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 007 · Datos del catálogo base (GENERADO: no editar a mano)
-- Generado por packages/catalog/scripts/generate-sql.ts
-- Fuente nutricional: ${SR28.source}
-- Huella del archivo fuente (sha256): ${SR28.file_sha256}
-- ${catalog.size} ingredientes · ${CATALOG_RECIPES.length} recetas
-- ════════════════════════════════════════════════════════════════════════
`);

// ─────────── Ingredientes ───────────
const ingRows = [...catalog.values()].map((b) => {
  const d = b.def;
  return `  (${[q(d.slug), q(d.name), q(d.category), q(d.state), q(d.unitG ?? null), q(d.exchange ?? null), q(b.exchangeGrams), q(d.exchange ? d.state : null), arr(d.allergens ?? [])].join(", ")})`;
});
parts.push(`-- Si ya existía un ingrediente global con el mismo nombre (cargado a mano), se adopta
update public.ingredients i set catalog_slug = v.slug
from (values
${[...catalog.values()].map((b) => `  (${q(b.def.slug)}, ${q(b.def.name)})`).join(",\n")}
) as v(slug, name)
where i.household_id is null and i.catalog_slug is null and lower(i.name) = lower(v.name)
  and not exists (select 1 from public.ingredients x where x.catalog_slug = v.slug);

insert into public.ingredients (household_id, catalog_slug, name, category, default_state, unit_weight_g, exchange_group_code, exchange_grams, exchange_state, allergen_tags)
select null, v.slug, v.name, v.category, v.state, v.unit_g::numeric, v.ex_group, v.ex_grams::numeric, v.ex_state, v.allergens
from (values
${ingRows.join(",\n")}
) as v(slug, name, category, state, unit_g, ex_group, ex_grams, ex_state, allergens)
on conflict (catalog_slug) where catalog_slug is not null do update set
  name = excluded.name, category = excluded.category, default_state = excluded.default_state,
  unit_weight_g = excluded.unit_weight_g, exchange_group_code = excluded.exchange_group_code,
  exchange_grams = excluded.exchange_grams, exchange_state = excluded.exchange_state,
  allergen_tags = excluded.allergen_tags, updated_at = now();
`);

// ─────────── Nutrición por 100 g ───────────
const nutRows: string[] = [];
for (const b of catalog.values()) {
  for (const [state, row] of Object.entries(b.nutrition)) {
    const n = row!.per100g;
    nutRows.push(`  (${[q(b.def.slug), q(state), q(n.kcal), q(n.protein_g), q(n.carbs_g), q(n.fat_g), q(n.fiber_g), q(n.sodium_mg), q(row!.sourceRef)].join(", ")})`);
  }
}
parts.push(`insert into public.ingredient_nutrition (ingredient_id, state, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, source, source_ref, confidence)
select i.id, v.state, v.kcal, v.p, v.c, v.f, v.fib, v.na, 'fdc', v.ref, 'calculated'
from (values
${nutRows.join(",\n")}
) as v(slug, state, kcal, p, c, f, fib, na, ref)
join public.ingredients i on i.catalog_slug = v.slug
on conflict (ingredient_id, state) do update set
  kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g,
  fiber_g = excluded.fiber_g, sodium_mg = excluded.sodium_mg, source = excluded.source,
  source_ref = excluded.source_ref, confidence = excluded.confidence;
`);

// ─────────── Rendimientos crudo → cocido ───────────
const withYield = [...catalog.values()].filter((b) => b.yieldFactor !== null);
parts.push(`insert into public.ingredient_yields (ingredient_id, method, yield_factor)
select i.id, 'default', v.y
from (values
${withYield.map((b) => `  (${q(b.def.slug)}, ${q(b.yieldFactor)})`).join(",\n")}
) as v(slug, y)
join public.ingredients i on i.catalog_slug = v.slug
on conflict (ingredient_id, method) do update set yield_factor = excluded.yield_factor;

-- Rendimientos que el catálogo ya no define
delete from public.ingredient_yields y
using public.ingredients i
where y.ingredient_id = i.id and i.catalog_slug is not null and y.method = 'default'
  and i.catalog_slug <> all (${arr(withYield.map((b) => b.def.slug))});
`);

// ─────────── Recetario base ───────────
const recRows = CATALOG_RECIPES.map((r) => {
  const lines = r.lines.map((l) => {
    const o: Record<string, unknown> = { ingredient: l.ingredient, grams: l.grams, state: l.state ?? catalog.get(l.ingredient)!.def.state, role: l.role };
    if (l.minG !== undefined) o.min_g = l.minG;
    if (l.maxG !== undefined) o.max_g = l.maxG;
    if (l.ratioGroup) o.ratio_group = l.ratioGroup;
    if (l.integerUnitG) o.integer_unit_g = l.integerUnitG;
    return o;
  });
  return `  (${[q(r.slug), q(r.name), q(r.category), arr(recipeTags(r)), q(r.prepMinutes), q(r.servings), q(r.homogeneous), q(r.expectedCookedYieldG ?? null), q(r.instructions), `${q(JSON.stringify(lines))}::jsonb`].join(", ")})`;
});
parts.push(`insert into public.recipe_catalog (slug, name, category, tags, prep_minutes, servings_nominal, is_homogeneous, expected_cooked_yield_g, instructions, lines)
select v.slug, v.name, v.category, v.tags, v.prep::int, v.servings::numeric, v.homog, v.yield_g::numeric, v.instructions, v.lines
from (values
${recRows.join(",\n")}
) as v(slug, name, category, tags, prep, servings, homog, yield_g, instructions, lines)
on conflict (slug) do update set
  name = excluded.name, category = excluded.category, tags = excluded.tags, prep_minutes = excluded.prep_minutes,
  servings_nominal = excluded.servings_nominal, is_homogeneous = excluded.is_homogeneous,
  expected_cooked_yield_g = excluded.expected_cooked_yield_g, instructions = excluded.instructions,
  lines = excluded.lines, catalog_version = public.recipe_catalog.catalog_version + 1, updated_at = now();

-- Cada hogar existente recibe las recetas del catálogo que le falten
select public._import_catalog_recipes(h.id) from public.households h;
`);

const dataSql = parts.join("\n");
writeFileSync(join(root, "supabase/migrations/20261023000007_catalog_data.sql"), dataSql);

// Archivo para pegar en el SQL Editor de un proyecto que ya tiene 001–005
const schema006 = readFileSync(join(root, "supabase/migrations/20261023000006_catalog.sql"), "utf8");
const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8");
writeFileSync(
  join(root, "supabase/catalogo_recetario.sql"),
  `-- NutriDuo: actualización con catálogo de ingredientes y recetario base.
-- Para un proyecto que YA tiene instalado setup_completo.sql. Pegar entero en
-- Supabase → SQL Editor → Run. Se puede ejecutar más de una vez sin duplicar nada.

${schema006}
-- Tabla de intercambios por defecto (por si no se cargó en la instalación; no duplica)
${seed}
${dataSql}`,
);

// Instalación completa para proyectos nuevos
const migDir = join(root, "supabase/migrations");
const all = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
writeFileSync(
  join(root, "supabase/setup_completo.sql"),
  `-- NutriDuo: instalación completa en un proyecto Supabase NUEVO.\n-- Pegar entero en Supabase → SQL Editor → Run. Generado desde supabase/migrations + seed.sql.\n` +
    [...all.map((f) => `supabase/migrations/${f}`), "supabase/seed.sql"]
      .map((f) => `\n-- ═══════════ ${f} ═══════════\n${readFileSync(join(root, f), "utf8")}`)
      .join(""),
);
console.log(`OK: ${catalog.size} ingredientes, ${CATALOG_RECIPES.length} recetas. Escribí 007, catalogo_recetario.sql y setup_completo.sql.`);
