-- ════════════════════════════════════════════════════════════════════════
-- Catálogo base: ingredientes globales, recetario e importación por hogar.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'e@test.local'),
  ('ffffffff-0000-0000-0000-000000000006', 'f@test.local');

create temp table cctx (k text primary key, v text);
grant all on cctx to authenticated;

-- ───────────── Datos cargados ─────────────
select tests.ok((select count(*) from public.ingredients where catalog_slug is not null) >= 90, 'hay al menos 90 ingredientes del catálogo');
select tests.ok(not exists (
  select 1 from public.ingredients i where i.catalog_slug is not null
    and not exists (select 1 from public.ingredient_nutrition n where n.ingredient_id = i.id and n.state = i.default_state)
), 'cada ingrediente del catálogo tiene nutrición en su estado por defecto');
select tests.ok(not exists (
  select 1 from public.ingredient_nutrition n join public.ingredients i on i.id = n.ingredient_id
  where i.catalog_slug is not null and (n.source <> 'fdc' or n.source_ref not like 'USDA SR28 NDB %')
), 'toda la nutrición del catálogo cita USDA SR28 y su NDB');
select tests.ok((select count(*) from public.recipe_catalog) >= 35, 'hay al menos 35 recetas en el recetario base');
select tests.ok(not exists (
  select 1 from public.recipe_catalog c, jsonb_array_elements(c.lines) l
  where not exists (select 1 from public.ingredients i where i.catalog_slug = l->>'ingredient')
), 'toda línea del recetario apunta a un ingrediente del catálogo');
select tests.ok((select yield_factor from public.ingredient_yields y join public.ingredients i on i.id = y.ingredient_id where i.catalog_slug = 'arroz') between 2.5 and 3.1, 'el arroz trae su rendimiento crudo→cocido');

-- ───────────── Importación automática al crear hogar ─────────────
select tests.login('eeeeeeee-0000-0000-0000-000000000005');
set role authenticated;
insert into cctx values ('hid', public.create_household('Casa E', 'Eva'));
select tests.ok((select count(*) from public.recipes where household_id = (select v::uuid from cctx where k = 'hid'))
  = (select count(*) from public.recipe_catalog), 'un hogar nuevo recibe todo el recetario base');
select tests.ok(not exists (
  select 1 from public.recipes r where r.household_id = (select v::uuid from cctx where k = 'hid')
    and (r.current_version_id is null or not exists (
      select 1 from public.recipe_versions v where v.id = r.current_version_id and v.sealed_at is not null))
), 'cada receta importada tiene versión actual sellada');
select tests.ok((
  select count(*) from public.recipe_ingredients ri
  join public.recipes r on r.current_version_id = ri.version_id
  where r.household_id = (select v::uuid from cctx where k = 'hid')
) = (select sum(jsonb_array_length(lines)) from public.recipe_catalog), 'las líneas importadas calzan con el recetario');
select tests.ok(public.import_catalog_recipes((select v::uuid from cctx where k = 'hid')) = 0, 'volver a importar no duplica nada');

-- Una receta borrada se puede volver a traer
delete from public.recipes where household_id = (select v::uuid from cctx where k = 'hid') and catalog_slug = 'tallarines-bolonesa';
select tests.ok(public.import_catalog_recipes((select v::uuid from cctx where k = 'hid')) = 1, 'importar trae solo la receta que falta');

-- Escritura del catálogo
select tests.throws($$insert into public.recipe_catalog (slug, name, category, servings_nominal, instructions, lines) values ('x', 'x', 'cenas', 1, 'x', '[{}]')$$, '42501', 'nadie escribe en el recetario base');
-- RLS deja el update sin filas (no lanza error): se verifica el resultado
update public.ingredients set name = 'hack' where catalog_slug = 'arroz';
reset role;
select tests.ok((select name from public.ingredients where catalog_slug = 'arroz') <> 'hack', 'nadie modifica ingredientes del catálogo');

-- ───────────── Ajustes de intercambio por hogar ─────────────
select tests.login('eeeeeeee-0000-0000-0000-000000000005');
set role authenticated;
insert into public.household_ingredient_overrides (household_id, ingredient_id, exchange_group_code, exchange_grams, note)
  select (select v::uuid from cctx where k = 'hid'), id, 'lacteos_altos_grasa', 30, 'pauta de la nutricionista'
  from public.ingredients where catalog_slug = 'queso-gauda';
select tests.ok((select count(*) from public.household_ingredient_overrides) = 1, 'el hogar ajusta la porción de intercambio de un ingrediente global');
reset role;

select tests.login('ffffffff-0000-0000-0000-000000000006');
set role authenticated;
insert into cctx values ('hidF', public.create_household('Casa F', 'Fran'));
select tests.ok((select count(*) from public.household_ingredient_overrides) = 0, 'otro hogar no ve los ajustes ajenos');
select tests.throws($$select public.import_catalog_recipes('$$ || (select v from cctx where k = 'hid') || $$')$$, null, 'no se importa en un hogar ajeno');
select tests.throws($$insert into public.household_ingredient_overrides (household_id, ingredient_id, exchange_group_code, exchange_grams) select '$$ || (select v from cctx where k = 'hid') || $$', id, 'cereales', 10 from public.ingredients where catalog_slug = 'arroz'$$, '42501', 'ni escribe ajustes en un hogar ajeno');
reset role;

set role authenticated;
select tests.throws($$select public._import_catalog_recipes('$$ || (select v from cctx where k = 'hidF') || $$')$$, '42501', 'la función interna no está expuesta a la app');
reset role;

\echo 'PRUEBAS DEL CATÁLOGO PASARON'
