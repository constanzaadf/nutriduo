-- ════════════════════════════════════════════════════════════════════════
-- Menú semanal: aplicar lotes y comidas en una transacción.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000009', 'g@test.local'),
  ('88888888-0000-0000-0000-000000000008', 'h@test.local'),
  ('77777777-0000-0000-0000-000000000007', 'i@test.local');

create temp table wctx (k text primary key, v text);
grant all on wctx to authenticated;

select tests.login('99999999-0000-0000-0000-000000000009');
set role authenticated;
insert into wctx values ('hid', public.create_household('Casa G', 'Gabi'));
insert into wctx select 'pG', id from public.nutrition_profiles where user_id = auth.uid();
insert into wctx select 'code', invite_code from public.households where id = (select v::uuid from wctx where k = 'hid');
reset role;
select tests.login('88888888-0000-0000-0000-000000000008');
set role authenticated;
select public.join_household((select v from wctx where k = 'code'), 'Hugo');
insert into wctx select 'pH', id from public.nutrition_profiles where user_id = auth.uid();
reset role;

-- Versiones del recetario del hogar
insert into wctx select 'vLent', r.current_version_id from public.recipes r
  where r.household_id = (select v::uuid from wctx where k = 'hid') and r.catalog_slug = 'lentejas-con-arroz';
insert into wctx select 'vHuevo', r.current_version_id from public.recipes r
  where r.household_id = (select v::uuid from wctx where k = 'hid') and r.catalog_slug = 'huevos-revueltos-tostadas';
insert into wctx select 'pan', id from public.ingredients where catalog_slug = 'pan-integral';

-- Menú: una olla (refri + congelador) y tres comidas, una con acompañamiento omitido
insert into wctx values ('batches', (
  select jsonb_build_array(
    jsonb_build_object('key', 'l1:fridge', 'recipe_version_id', (select v from wctx where k = 'vLent'), 'planned_for', '2026-10-25',
      'raw_input', '[{"ingredientId":"x","grams":300,"state":"raw"}]'::jsonb, 'expected_cooked_g', 1500, 'location', 'fridge', 'frozen', false, 'use_by', '2026-10-28'),
    jsonb_build_object('key', 'l1:freezer', 'recipe_version_id', (select v from wctx where k = 'vLent'), 'planned_for', '2026-10-25',
      'raw_input', '[{"ingredientId":"x","grams":200,"state":"raw"}]'::jsonb, 'expected_cooked_g', 1000, 'location', 'freezer', 'frozen', true, 'use_by', '2026-12-24'))::text));
insert into wctx values ('events', (
  select jsonb_build_array(
    jsonb_build_object('date', '2026-10-26', 'slot', 'lunch', 'mode', 'A', 'recipe_version_id', (select v from wctx where k = 'vLent'),
      'batch_key', 'l1:fridge', 'profiles', jsonb_build_array((select v from wctx where k = 'pG'), (select v from wctx where k = 'pH'))),
    jsonb_build_object('date', '2026-10-29', 'slot', 'lunch', 'mode', 'A', 'recipe_version_id', (select v from wctx where k = 'vLent'),
      'batch_key', 'l1:freezer', 'profiles', jsonb_build_array((select v from wctx where k = 'pG'), (select v from wctx where k = 'pH'))),
    jsonb_build_object('date', '2026-10-26', 'slot', 'breakfast', 'mode', 'C', 'recipe_version_id', (select v from wctx where k = 'vHuevo'),
      'batch_key', null, 'profiles', jsonb_build_array((select v from wctx where k = 'pG'), (select v from wctx where k = 'pH')),
      'skip_sides', jsonb_build_object((select v from wctx where k = 'pG'), jsonb_build_array((select v from wctx where k = 'pan')))))::text));

select tests.login('99999999-0000-0000-0000-000000000009');
set role authenticated;
insert into wctx select 'res', public.apply_week_menu((select v::uuid from wctx where k = 'hid'), (select v::jsonb from wctx where k = 'batches'), (select v::jsonb from wctx where k = 'events'))::text;
select tests.ok(jsonb_array_length((select v::jsonb -> 'events' from wctx where k = 'res')) = 3, 'aplica las tres comidas');
select tests.ok((select count(*) from public.cooking_batches where household_id = (select v::uuid from wctx where k = 'hid')) = 2, 'crea los dos lotes (refrigerado y congelado)');
select tests.ok((select frozen and location = 'freezer' from public.cooking_batches where id = ((select v::jsonb from wctx where k = 'res') -> 'batches' ->> 'l1:freezer')::uuid), 'el lote para congelar queda marcado');
select tests.ok((select batch_id = ((select v::jsonb from wctx where k = 'res') -> 'batches' ->> 'l1:freezer')::uuid from public.meal_events where date = '2026-10-29' and slot = 'lunch'), 'la comida del jueves sale del lote congelado');
select tests.ok((select count(*) from public.meal_participants where date = '2026-10-26' and slot = 'lunch') = 2, 'ambos participan de la comida compartida');
select tests.ok((
  select options -> 'skip_sides' = jsonb_build_array((select v from wctx where k = 'pan'))
  from public.meal_participants where date = '2026-10-26' and slot = 'breakfast' and profile_id = (select v::uuid from wctx where k = 'pG')
), 'el acompañamiento omitido queda en las opciones de esa persona');
select tests.ok((
  select options = '{}'::jsonb from public.meal_participants where date = '2026-10-26' and slot = 'breakfast' and profile_id = (select v::uuid from wctx where k = 'pH')
), 'la otra persona come la receta completa');

-- Todo o nada: si un tiempo ya está ocupado no se crea ningún lote ni comida
select tests.throws($$select public.apply_week_menu('$$ || (select v from wctx where k = 'hid') || $$', '$$ || (select v from wctx where k = 'batches') || $$', '$$ || (select v from wctx where k = 'events') || $$')$$, 'slot_taken', 'un tiempo ocupado rechaza el menú');
select tests.ok((select count(*) from public.cooking_batches where household_id = (select v::uuid from wctx where k = 'hid')) = 2, 'y no deja lotes a medias');
reset role;

-- Otro hogar no puede aplicar menús en este
select tests.login('77777777-0000-0000-0000-000000000007');
set role authenticated;
select tests.throws($$select public.apply_week_menu('$$ || (select v from wctx where k = 'hid') || $$', '[]', '[]')$$, '42501', 'nadie aplica un menú en un hogar ajeno');
reset role;

\echo 'PRUEBAS DEL MENÚ SEMANAL PASARON'
