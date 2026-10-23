-- ════════════════════════════════════════════════════════════════════════
-- Pruebas de integridad (sección 13) y privacidad (RLS) contra la base real.
-- A = Coni, B = su pareja, C = otro hogar, D = intruso que intenta unirse.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.local'),
  ('cccccccc-0000-0000-0000-000000000003', 'c@test.local'),
  ('dddddddd-0000-0000-0000-000000000004', 'd@test.local');

-- Ingrediente global (catálogo) cargado por el sistema
insert into public.ingredients (id, household_id, name, category, default_state, allergen_tags)
  values ('11111111-0000-0000-0000-000000000001', null, 'Arroz blanco', 'cereales', 'raw', '{}');
insert into public.ingredient_nutrition (ingredient_id, state, kcal, protein_g, carbs_g, fat_g, fiber_g, source, source_ref)
  values ('11111111-0000-0000-0000-000000000001', 'raw', 360, 7, 79, 0.6, 1.3, 'manual', 'prueba');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;

-- ───────────── Alta del hogar ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into ctx values ('hid', public.create_household('Casa', 'Coni'));
insert into ctx select 'code', invite_code from public.households where id = (select v::uuid from ctx where k = 'hid');
insert into ctx select 'pA', id from public.nutrition_profiles where user_id = auth.uid();
select tests.ok((select count(*) from public.household_members) = 1, 'A crea el hogar y queda como integrante');
reset role;

select tests.login('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
select public.join_household((select v from ctx where k = 'code'), 'Pareja');
insert into ctx select 'pB', id from public.nutrition_profiles where user_id = auth.uid();
select tests.ok((select count(*) from public.household_members) = 2, 'B se une con el código y ve ambas membresías');
select tests.ok((select count(*) from public.household_people((select v::uuid from ctx where k = 'hid'))) = 2, 'household_people lista a ambos (sin datos de salud)');
select tests.ok((select count(*) from public.nutrition_profiles) = 1, 'B solo ve su propio perfil completo (visibilidad por defecto: summary)');
reset role;

select tests.login('dddddddd-0000-0000-0000-000000000004');
set role authenticated;
select tests.throws($$select public.join_household('$$ || (select v from ctx where k = 'code') || $$', 'Intruso')$$, 'household_full', 'un tercer integrante no entra a un hogar de 2');
select tests.throws($$select public.join_household('NOEXISTE', 'Intruso')$$, 'invalid_invite', 'código inválido');
reset role;

select tests.login('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
insert into ctx values ('hidC', public.create_household('Otra casa', 'Carla'));
reset role;

-- ───────────── Ingredientes y recetas (A) ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.ingredients (id, household_id, name, category, default_state, allergen_tags) values
  ('22222222-0000-0000-0000-000000000001', (select v::uuid from ctx where k = 'hid'), 'Pollo', 'carnes', 'raw', '{}'),
  ('22222222-0000-0000-0000-000000000002', (select v::uuid from ctx where k = 'hid'), 'Maní tostado', 'frutos_secos', 'as_sold', '{mani}'),
  ('22222222-0000-0000-0000-000000000003', (select v::uuid from ctx where k = 'hid'), 'Aceite', 'grasas', 'as_sold', '{}');
select tests.ok((select count(*) from public.ingredients where household_id is not null) = 3 and (select count(*) from public.ingredients where household_id is null) > 90, 'A ve el catálogo global más los ingredientes de su hogar');
select tests.throws($$insert into public.ingredients (household_id, name) values (null, 'Hackeo global')$$, '42501', 'nadie escribe en el catálogo global');

insert into ctx values ('r1', public.create_recipe(
  (select v::uuid from ctx where k = 'hid'),
  '{"name":"Pollo con arroz","category":"almuerzos","tags":["alta en proteínas"]}',
  '{"name":"Pollo con arroz","servings_nominal":2}',
  '[{"ingredient_id":"22222222-0000-0000-0000-000000000001","grams":150,"state":"raw","role":"adjustable"},
    {"ingredient_id":"11111111-0000-0000-0000-000000000001","grams":70,"state":"raw","role":"side"},
    {"ingredient_id":"22222222-0000-0000-0000-000000000003","grams":8,"state":"as_sold","role":"adjustable"}]'));
insert into ctx select 'v1', current_version_id from public.recipes where id = (select v::uuid from ctx where k = 'r1');
select tests.ok((select sealed_at is not null from public.recipe_versions where id = (select v::uuid from ctx where k = 'v1')), 'la versión queda sellada al crearse');

-- Criterio 8: la receta original se conserva
select tests.throws($$update public.recipe_versions set name = 'cambiado' where id = '$$ || (select v from ctx where k = 'v1') || $$'$$, 'recipe_version_immutable', 'una versión sellada no se puede editar');
select tests.throws($$update public.recipe_ingredients set grams = 999 where version_id = '$$ || (select v from ctx where k = 'v1') || $$'$$, 'recipe_version_immutable', 'sus ingredientes tampoco');
select tests.throws($$insert into public.recipe_ingredients (version_id, position, ingredient_id, grams, state) values ('$$ || (select v from ctx where k = 'v1') || $$', 9, '22222222-0000-0000-0000-000000000003', 5, 'as_sold')$$, 'recipe_version_immutable', 'ni se le agregan líneas');

insert into ctx values ('v2', public.create_recipe_version(
  (select v::uuid from ctx where k = 'r1'),
  '{"name":"Pollo con arroz (fit)","servings_nominal":2,"change_log":[{"change":"menos aceite","why":"reduce grasa sin cambiar el plato"}]}',
  '[{"ingredient_id":"22222222-0000-0000-0000-000000000001","grams":170,"state":"raw","role":"adjustable"},
    {"ingredient_id":"11111111-0000-0000-0000-000000000001","grams":60,"state":"raw","role":"side"},
    {"ingredient_id":"22222222-0000-0000-0000-000000000003","grams":4,"state":"as_sold","role":"adjustable"}]',
  (select v::uuid from ctx where k = 'v1'), 'optimized', true));
select tests.ok((select version_no = 2 from public.recipe_versions where id = (select v::uuid from ctx where k = 'v2')), 'la versión optimizada es la n.º 2');
select tests.ok((select grams = 8 from public.recipe_ingredients where version_id = (select v::uuid from ctx where k = 'v1') and position = 3), 'la original sigue con 8 g de aceite');
select tests.ok((select current_version_id = (select v::uuid from ctx where k = 'v2') from public.recipes where id = (select v::uuid from ctx where k = 'r1')), 'la vigente pasa a ser la optimizada');

-- Receta con maní en la base y otra con maní como acompañamiento
insert into ctx values ('rMani', public.create_recipe((select v::uuid from ctx where k = 'hid'), '{"name":"Pollo al maní"}', '{"name":"Pollo al maní","servings_nominal":2}',
  '[{"ingredient_id":"22222222-0000-0000-0000-000000000001","grams":150,"state":"raw"},{"ingredient_id":"22222222-0000-0000-0000-000000000002","grams":20,"state":"as_sold"}]'));
insert into ctx select 'vMani', current_version_id from public.recipes where id = (select v::uuid from ctx where k = 'rMani');
insert into ctx values ('rManiSide', public.create_recipe((select v::uuid from ctx where k = 'hid'), '{"name":"Pollo con maní aparte"}', '{"name":"Pollo con maní aparte","servings_nominal":2}',
  '[{"ingredient_id":"22222222-0000-0000-0000-000000000001","grams":150,"state":"raw"},{"ingredient_id":"22222222-0000-0000-0000-000000000002","grams":20,"state":"as_sold","role":"side"}]'));
insert into ctx select 'vManiSide', current_version_id from public.recipes where id = (select v::uuid from ctx where k = 'rManiSide');
reset role;

-- ───────────── Metas y privacidad ─────────────
select tests.login('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
select public.set_current_goal((select v::uuid from ctx where k = 'pB'),
  '{"source":"calculated","confidence":"calculated","kcal":2600,"protein_g":150,"carbs_g":320,"fat_g":80,"fiber_g":36}',
  '[{"slot":"breakfast","kcal_share":0.25},{"slot":"lunch","kcal_share":0.35},{"slot":"dinner","kcal_share":0.3},{"slot":"snack_pm","kcal_share":0.1}]');
select tests.ok((select count(*) from public.nutrition_goals where valid_to is null) = 1, 'B tiene una meta vigente');
select tests.throws($$select public.set_current_goal('$$ || (select v from ctx where k = 'pB') || $$', '{"source":"manual","confidence":"calculated","kcal":2500,"protein_g":150,"carbs_g":300,"fat_g":80}', '[{"slot":"lunch","kcal_share":0.5},{"slot":"dinner","kcal_share":0.4}]')$$,
  'slot_shares_sum', 'el reparto por comida debe sumar 100 %', true);
-- B registra una alergia al maní
insert into public.dietary_restrictions (profile_id, tag, severity) values ((select v::uuid from ctx where k = 'pB'), 'mani', 'allergy');
reset role;

select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select tests.ok((select count(*) from public.nutrition_goals) = 0, 'A no ve las metas de B con visibilidad summary');
select tests.ok((select count(*) from public.dietary_restrictions) = 1, 'pero sí ve la alergia de B (necesaria para cocinar)');
select tests.throws($$insert into public.nutrition_goals (profile_id, source, confidence, kcal, protein_g, carbs_g, fat_g) values ('$$ || (select v from ctx where k = 'pB') || $$', 'manual', 'calculated', 1500, 100, 150, 50)$$,
  '42501', 'A no puede escribir metas en el perfil de B');
select tests.ok((select count(*) from public.nutrition_profiles where id = (select v::uuid from ctx where k = 'pB')) = 0, 'A no lee el perfil de salud de B');
reset role;

-- ───────────── Calendario híbrido ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
-- Modalidad A: un evento, dos participantes
insert into ctx values ('e1', public.create_meal_event((select v::uuid from ctx where k = 'hid'), '2026-10-26', 'lunch', 'A',
  (select v::uuid from ctx where k = 'v2'), array[(select v::uuid from ctx where k = 'pA'), (select v::uuid from ctx where k = 'pB')])::text);
select tests.ok((select count(*) from public.meal_events) = 1 and (select count(*) from public.meal_participants) = 2, 'comida compartida = 1 evento con 2 participantes');
select tests.ok((select iso_week from public.meal_plans) = '2026-W44', 'el plan semanal se crea por semana ISO');

-- Criterio 3 / doble contabilización: un perfil no puede tener dos comidas principales en el mismo slot
select tests.throws($$select public.create_meal_event('$$ || (select v from ctx where k = 'hid') || $$', '2026-10-26', 'lunch', 'B', '$$ || (select v from ctx where k = 'v1') || $$', array['$$ || (select v from ctx where k = 'pA') || $$'::uuid])$$,
  '23505', 'A no puede tener dos almuerzos el mismo día');
select tests.throws($$select public.create_meal_event('$$ || (select v from ctx where k = 'hid') || $$', '2026-10-27', 'lunch', 'B', '$$ || (select v from ctx where k = 'v1') || $$', array['$$ || (select v from ctx where k = 'pA') || $$'::uuid, '$$ || (select v from ctx where k = 'pB') || $$'::uuid])$$,
  '23514', 'una comida individual (B) tiene un solo participante');

-- Alergia como restricción dura (criterio 11)
select tests.throws($$select public.create_meal_event('$$ || (select v from ctx where k = 'hid') || $$', '2026-10-28', 'dinner', 'A', '$$ || (select v from ctx where k = 'vMani') || $$', array['$$ || (select v from ctx where k = 'pA') || $$'::uuid, '$$ || (select v from ctx where k = 'pB') || $$'::uuid])$$,
  'allergen_blocked', 'B no puede participar de una receta con maní en la base');
insert into ctx values ('eSide', public.create_meal_event((select v::uuid from ctx where k = 'hid'), '2026-10-28', 'dinner', 'C',
  (select v::uuid from ctx where k = 'vManiSide'), array[(select v::uuid from ctx where k = 'pA'), (select v::uuid from ctx where k = 'pB')])::text);
select tests.ok(true, 'con el maní como acompañamiento, B sí puede compartir la base (modalidad C)');
select tests.throws($$update public.meal_events set recipe_version_id = '$$ || (select v from ctx where k = 'vMani') || $$' where id = '$$ || (select v from ctx where k = 'eSide') || $$'$$,
  'allergen_blocked', 'cambiar el evento a una receta con maní en la base se bloquea');

-- Aprobar porciones: A guarda la porción de ambos
insert into ctx select 'ver1', row_version::text from public.meal_events where id = (select v::uuid from ctx where k = 'e1');
select public.approve_meal_portions((select v::uuid from ctx where k = 'e1'), (select v::int from ctx where k = 'ver1'),
  json_build_array(
    json_build_object('profile_id', (select v from ctx where k = 'pA'), 'status', 'within_tolerance', 'confidence', 'calculated', 'total_g', 300, 'plate_g', 380, 'kcal', 550, 'protein_g', 42, 'carbs_g', 54, 'fat_g', 16,
      'items', json_build_array(json_build_object('ingredient_id', '22222222-0000-0000-0000-000000000001', 'kind', 'line', 'label', 'Pollo', 'grams', 160, 'state', 'raw'))),
    json_build_object('profile_id', (select v from ctx where k = 'pB'), 'status', 'within_tolerance', 'confidence', 'calculated', 'total_g', 420, 'plate_g', 560, 'kcal', 900, 'protein_g', 60, 'carbs_g', 110, 'fat_g', 24,
      'items', json_build_array(json_build_object('ingredient_id', '22222222-0000-0000-0000-000000000001', 'kind', 'line', 'label', 'Pollo', 'grams', 210, 'state', 'raw')))
  )::jsonb,
  '{"engine_version":"1.0.0","input_hash":"abcd1234","inputs":{},"outputs":{}}');
select tests.ok((select count(*) from public.meal_portions) = 1, 'A ve los macros solo de su porción');
select tests.ok((select count(*) from public.portion_ingredients) = 2, 'pero ve los gramos de ambos (summary)');
select tests.ok((select count(*) from public.event_portion_lines(array[(select v::uuid from ctx where k = 'e1')])) = 2, 'event_portion_lines entrega los gramos de ambos para el calendario');
select tests.ok((select plan_status = 'approved' from public.meal_events where id = (select v::uuid from ctx where k = 'e1')), 'el evento queda aprobado');
select tests.throws($$select public.approve_meal_portions('$$ || (select v from ctx where k = 'e1') || $$', $$ || (select v from ctx where k = 'ver1') || $$, '[]', '{"engine_version":"1"}')$$,
  'event_version_conflict', 'edición concurrente: aprobar con una versión vieja falla');

-- Ingrediente con alérgeno en la porción de B (extra) se bloquea
insert into ctx select 'ver2', row_version::text from public.meal_events where id = (select v::uuid from ctx where k = 'eSide');
select tests.throws($$select public.approve_meal_portions('$$ || (select v from ctx where k = 'eSide') || $$', $$ || (select v from ctx where k = 'ver2') || $$,
  '[{"profile_id":"$$ || (select v from ctx where k = 'pB') || $$","status":"within_tolerance","confidence":"calculated","total_g":200,"kcal":500,"protein_g":40,"carbs_g":20,"fat_g":20,
     "items":[{"ingredient_id":"22222222-0000-0000-0000-000000000002","kind":"line","label":"Maní","grams":20,"state":"as_sold"}]}]', '{"engine_version":"1"}')$$,
  'allergen_blocked', 'el maní no puede entrar a la porción de B ni como acompañamiento');

-- Mover el evento mueve a sus participantes
update public.meal_events set date = '2026-10-29' where id = (select v::uuid from ctx where k = 'eSide');
select tests.ok((select bool_and(date = '2026-10-29') from public.meal_participants where event_id = (select v::uuid from ctx where k = 'eSide')), 'mover una comida mueve a sus participantes');
reset role;

-- B decide privacidad total para A, luego visibilidad completa
select tests.login('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
update public.visibility_grants set level = 'private' where owner_profile_id = (select v::uuid from ctx where k = 'pB');
reset role;
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select tests.ok((select count(*) from public.portion_ingredients) = 1, 'con private, A ya no ve ni los gramos de B');
select tests.ok((select count(*) from public.event_portion_lines(array[(select v::uuid from ctx where k = 'e1')])) = 1, 'ni a través de event_portion_lines');
reset role;
select tests.login('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
update public.visibility_grants set level = 'full' where owner_profile_id = (select v::uuid from ctx where k = 'pB');
reset role;
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select tests.ok((select count(*) from public.nutrition_goals) = 1 and (select count(*) from public.meal_portions) = 2, 'con full, A ve metas y macros de B');
update public.visibility_grants set level = 'full'
  where owner_profile_id = (select v::uuid from ctx where k = 'pA') and viewer_profile_id = (select v::uuid from ctx where k = 'pB');
select tests.ok((select level = 'full' from public.visibility_grants where owner_profile_id = (select v::uuid from ctx where k = 'pA')), 'A sí puede cambiar SU propia visibilidad');
update public.visibility_grants set level = 'private' where owner_profile_id = (select v::uuid from ctx where k = 'pB');
select tests.ok((select level = 'full' from public.visibility_grants where owner_profile_id = (select v::uuid from ctx where k = 'pB')), 'A no puede cambiar la visibilidad que B le dio');
reset role;

-- ───────────── Consumo ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.consumption_logs (profile_id, date, slot, event_id, kind, kcal, protein_g, carbs_g, fat_g)
  values ((select v::uuid from ctx where k = 'pA'), '2026-10-26', 'lunch', (select v::uuid from ctx where k = 'e1'), 'as_planned', 550, 42, 54, 16);
select tests.throws($$insert into public.consumption_logs (profile_id, date, slot, event_id, kind) values ('$$ || (select v from ctx where k = 'pA') || $$', '2026-10-26', 'lunch', '$$ || (select v from ctx where k = 'e1') || $$', 'as_planned')$$,
  '23505', 'la misma comida no se registra dos veces');
select tests.throws($$insert into public.consumption_logs (profile_id, date, slot, kind) values ('$$ || (select v from ctx where k = 'pB') || $$', '2026-10-26', 'dinner', 'skipped')$$,
  '42501', 'A no registra consumo en nombre de B');
reset role;

-- ───────────── Lotes ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.cooking_batches (id, household_id, recipe_version_id, status, expected_cooked_g)
  values ('33333333-0000-0000-0000-000000000001', (select v::uuid from ctx where k = 'hid'), (select v::uuid from ctx where k = 'v2'), 'planned', 1000);
insert into public.batch_allocations (batch_id, event_id, grams_cooked) values ('33333333-0000-0000-0000-000000000001', (select v::uuid from ctx where k = 'e1'), 600);
insert into public.batch_allocations (batch_id, destination, grams_cooked) values ('33333333-0000-0000-0000-000000000001', 'freezer', 300);
select tests.throws($$insert into public.batch_allocations (batch_id, destination, grams_cooked) values ('33333333-0000-0000-0000-000000000001', 'fridge', 200)$$,
  'batch_over_allocated', 'las asignaciones no superan el lote (900 + 200 > 1000)');
select tests.throws($$select public.mark_batch_cooked('33333333-0000-0000-0000-000000000001', 850, true)$$,
  'batch_over_allocated', 'pesar el lote bajo lo asignado se rechaza');
select public.mark_batch_cooked('33333333-0000-0000-0000-000000000001', 950, true);
select tests.ok((select measured and cooked_total_g = 950 from public.cooking_batches), 'el lote pesado queda con su peso real');
reset role;

-- ───────────── Inventario ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into public.inventory_items (id, household_id, ingredient_id, grams, state)
  values ('44444444-0000-0000-0000-000000000001', (select v::uuid from ctx where k = 'hid'), '11111111-0000-0000-0000-000000000001', 500, 'raw');
insert into public.inventory_reservations (inventory_item_id, event_id, grams) values ('44444444-0000-0000-0000-000000000001', (select v::uuid from ctx where k = 'e1'), 300);
select tests.throws($$insert into public.inventory_reservations (inventory_item_id, event_id, grams) values ('44444444-0000-0000-0000-000000000001', '$$ || (select v from ctx where k = 'e1') || $$', 300)$$,
  'inventory_over_reserved', 'no se reserva inventario inexistente');
select tests.throws($$update public.inventory_items set grams = 200 where id = '44444444-0000-0000-0000-000000000001'$$,
  'inventory_over_reserved', 'el stock no baja de lo reservado');
select tests.throws($$update public.inventory_items set grams = -5 where id = '44444444-0000-0000-0000-000000000001'$$,
  '23514', 'el stock nunca es negativo');
reset role;

-- ───────────── Compras ─────────────
select tests.login('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
insert into public.shopping_lists (id, household_id, plan_id) values ('55555555-0000-0000-0000-000000000001', (select v::uuid from ctx where k = 'hid'), (select id from public.meal_plans limit 1));
select public.apply_shopping_items('55555555-0000-0000-0000-000000000001',
  '[{"key":"pollo|raw","ingredient_id":"22222222-0000-0000-0000-000000000001","label":"Pollo","category":"carnes","state":"raw","need_g":370,"buy_g":370},
    {"key":"manual:papel","label":"Papel de cocina","manual":true,"manual_quantity":"1 rollo"}]',
  '{"engine_version":"1.0.0","input_hash":"x"}');
select tests.ok((select count(*) from public.shopping_list_items) = 2, 'B (el otro integrante) gestiona la misma lista del hogar');
select tests.throws($$insert into public.shopping_list_items (list_id, key, label, buy_g) values ('55555555-0000-0000-0000-000000000001', 'x', 'sin ingrediente ni manual', 1)$$,
  '23514', 'un ítem no manual necesita ingrediente');
reset role;

-- ───────────── Trazas ─────────────
select tests.login('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select tests.throws($$update public.calculation_runs set engine_version = 'x'$$, '42501', 'las trazas de cálculo no se modifican');
reset role;
select tests.throws($$update public.calculation_runs set engine_version = 'x'$$, '23514', 'ni siquiera como administrador');

-- ───────────── Aislamiento entre hogares ─────────────
select tests.login('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
select tests.ok((select count(*) from public.recipes where household_id <> (select v::uuid from ctx where k = 'hidC')) = 0, 'otro hogar no ve recetas ajenas');
select tests.ok((select count(*) from public.meal_events) = 0, 'ni el calendario');
select tests.ok((select count(*) from public.shopping_list_items) = 0, 'ni la lista de compras');
select tests.ok((select count(*) from public.dietary_restrictions) = 0, 'ni las alergias');
select tests.ok((select count(*) from public.ingredients where household_id is not null) = 0, 'solo el catálogo global');
select tests.throws($$insert into public.recipes (household_id, name) values ('$$ || (select v from ctx where k = 'hid') || $$', 'intrusa')$$, '42501', 'ni puede escribir en él');
reset role;

-- ───────────── Sin sesión ─────────────
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.throws($$select count(*) from public.recipes$$, '42501', 'anon no tiene acceso a ninguna tabla');
reset role;

\echo 'TODAS LAS PRUEBAS SQL PASARON'
