-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 004 · Operaciones transaccionales
-- Toda operación de varios pasos ocurre en una sola transacción. Salvo las
-- de alta en el hogar (que necesitan crear la primera membresía), son
-- SECURITY INVOKER: corren con los permisos del usuario y respetan RLS.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.iso_week_of(p_date date) returns text
language sql immutable as $$ select to_char(p_date, 'IYYY-"W"IW') $$;

create or replace function public.new_invite_code() returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8)
$$;

-- ───────────── Alta del hogar ─────────────

create or replace function public.create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_household uuid;
  v_profile uuid;
begin
  if v_uid is null then
    raise exception 'Sesión requerida' using errcode = '28000';
  end if;
  insert into public.users (id, display_name) values (v_uid, p_display_name)
    on conflict (id) do update set display_name = excluded.display_name;
  insert into public.households (name, created_by, invite_code)
    values (p_name, v_uid, public.new_invite_code()) returning id into v_household;
  insert into public.nutrition_profiles (household_id, user_id, display_name)
    values (v_household, v_uid, p_display_name) returning id into v_profile;
  insert into public.household_members (household_id, user_id, role, profile_id)
    values (v_household, v_uid, 'owner', v_profile);
  return v_household;
end $$;

-- Unirse con código. Si se indica un perfil gestionado (creado antes de que la
-- persona tuviera cuenta), se vincula en vez de crear uno nuevo.
create or replace function public.join_household(p_code text, p_display_name text, p_claim_profile uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_household uuid;
  v_profile uuid;
  v_other uuid;
begin
  if v_uid is null then
    raise exception 'Sesión requerida' using errcode = '28000';
  end if;
  select id into v_household from public.households where invite_code = upper(trim(p_code));
  if v_household is null then
    raise exception 'Código de invitación inválido' using errcode = 'no_data_found', hint = 'invalid_invite';
  end if;
  if exists (select 1 from public.household_members where household_id = v_household and user_id = v_uid) then
    return v_household;
  end if;
  insert into public.users (id, display_name) values (v_uid, p_display_name)
    on conflict (id) do update set display_name = excluded.display_name;

  if p_claim_profile is not null then
    update public.nutrition_profiles set user_id = v_uid, managed_by = null, display_name = p_display_name
      where id = p_claim_profile and household_id = v_household and user_id is null
      returning id into v_profile;
    if v_profile is null then
      raise exception 'Ese perfil no está disponible para vincular' using errcode = 'check_violation';
    end if;
  else
    insert into public.nutrition_profiles (household_id, user_id, display_name)
      values (v_household, v_uid, p_display_name) returning id into v_profile;
  end if;

  insert into public.household_members (household_id, user_id, role, profile_id)
    values (v_household, v_uid, 'member', v_profile);

  -- Visibilidad por defecto entre integrantes: "summary" (gramos, sin metas ni macros)
  for v_other in select id from public.nutrition_profiles where household_id = v_household and id <> v_profile loop
    insert into public.visibility_grants (owner_profile_id, viewer_profile_id, level)
      values (v_profile, v_other, 'summary'), (v_other, v_profile, 'summary')
      on conflict do nothing;
  end loop;
  return v_household;
end $$;

create or replace function public.regenerate_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_owner(p_household) then
    raise exception 'Solo quien administra el hogar puede cambiar el código' using errcode = '42501';
  end if;
  update public.households set invite_code = public.new_invite_code() where id = p_household returning invite_code into v_code;
  return v_code;
end $$;

-- ───────────── Metas ─────────────

-- Reemplaza la meta vigente: la anterior queda cerrada (historial), nunca se sobrescribe.
create or replace function public.set_current_goal(p_profile uuid, p_goal jsonb, p_slots jsonb default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_goal uuid;
  v_slot record;
begin
  update public.nutrition_goals set valid_to = current_date
    where profile_id = p_profile and valid_to is null;
  insert into public.nutrition_goals (
    profile_id, mode, source, confidence, kcal, protein_g, carbs_g, fat_g, fiber_g,
    exchange_portions, by_weekday, prescribed_by, valid_from, calc_run_id, notes)
  values (
    p_profile,
    coalesce(p_goal ->> 'mode', 'macros'),
    p_goal ->> 'source',
    p_goal ->> 'confidence',
    (p_goal ->> 'kcal')::numeric,
    (p_goal ->> 'protein_g')::numeric,
    (p_goal ->> 'carbs_g')::numeric,
    (p_goal ->> 'fat_g')::numeric,
    (p_goal ->> 'fiber_g')::numeric,
    p_goal -> 'exchange_portions',
    p_goal -> 'by_weekday',
    p_goal ->> 'prescribed_by',
    current_date,
    nullif(p_goal ->> 'calc_run_id', '')::uuid,
    p_goal ->> 'notes')
  returning id into v_goal;

  if p_slots is not null then
    for v_slot in select * from jsonb_to_recordset(p_slots) as x(slot text, kcal_share numeric, exchange_portions jsonb) loop
      insert into public.meal_slot_targets (goal_id, slot, kcal_share, exchange_portions)
        values (v_goal, v_slot.slot, v_slot.kcal_share, v_slot.exchange_portions);
    end loop;
  end if;
  return v_goal;
end $$;

-- ───────────── Recetas ─────────────

-- Crea una versión inmutable con sus ingredientes, la sella y (opcionalmente) la deja vigente.
create or replace function public.create_recipe_version(
  p_recipe uuid, p_version jsonb, p_lines jsonb, p_parent uuid default null,
  p_origin text default 'manual', p_make_current boolean default true)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_version uuid;
  v_no int;
  v_line record;
  v_pos int := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'La versión necesita al menos un ingrediente' using errcode = 'check_violation';
  end if;
  select coalesce(max(version_no), 0) + 1 into v_no from public.recipe_versions where recipe_id = p_recipe;
  insert into public.recipe_versions (
    recipe_id, parent_version_id, version_no, origin, name, servings_nominal, is_homogeneous,
    expected_cooked_yield_g, instructions, change_log, created_by)
  values (
    p_recipe, p_parent, v_no, p_origin, p_version ->> 'name',
    (p_version ->> 'servings_nominal')::numeric,
    coalesce((p_version ->> 'is_homogeneous')::boolean, false),
    nullif(p_version ->> 'expected_cooked_yield_g', '')::numeric,
    p_version ->> 'instructions',
    coalesce(p_version -> 'change_log', '[]'::jsonb),
    auth.uid())
  returning id into v_version;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(
      ingredient_id uuid, grams numeric, state text, role text, min_g numeric, max_g numeric,
      ratio_group text, integer_unit_g numeric, note text) loop
    v_pos := v_pos + 1;
    insert into public.recipe_ingredients (version_id, position, ingredient_id, grams, state, role, min_g, max_g, ratio_group, integer_unit_g, note)
      values (v_version, v_pos, v_line.ingredient_id, v_line.grams, v_line.state, coalesce(v_line.role, 'adjustable'),
              v_line.min_g, v_line.max_g, v_line.ratio_group, v_line.integer_unit_g, v_line.note);
  end loop;

  update public.recipe_versions set sealed_at = now() where id = v_version;
  if p_make_current then
    update public.recipes set current_version_id = v_version where id = p_recipe;
  end if;
  return v_version;
end $$;

create or replace function public.create_recipe(p_household uuid, p_recipe jsonb, p_version jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_recipe uuid;
begin
  insert into public.recipes (household_id, name, category, tags, photo_path, prep_minutes, source_url, created_by)
  values (
    p_household, p_recipe ->> 'name', coalesce(p_recipe ->> 'category', 'almuerzos'),
    coalesce(array(select jsonb_array_elements_text(p_recipe -> 'tags')), '{}'),
    p_recipe ->> 'photo_path', nullif(p_recipe ->> 'prep_minutes', '')::int, p_recipe ->> 'source_url', auth.uid())
  returning id into v_recipe;
  perform public.create_recipe_version(v_recipe, p_version, p_lines, null, 'original', true);
  return v_recipe;
end $$;

-- ───────────── Calendario ─────────────

create or replace function public.ensure_meal_plan(p_household uuid, p_date date)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_plan uuid;
begin
  insert into public.meal_plans (household_id, iso_week) values (p_household, public.iso_week_of(p_date))
    on conflict (household_id, iso_week) do nothing;
  select id into v_plan from public.meal_plans where household_id = p_household and iso_week = public.iso_week_of(p_date);
  return v_plan;
end $$;

-- Un evento, N participantes. En modalidad B se llama una vez por perfil.
create or replace function public.create_meal_event(
  p_household uuid, p_date date, p_slot text, p_mode text, p_version uuid,
  p_profiles uuid[], p_batch uuid default null, p_cook_servings numeric default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_event uuid;
  v_profile uuid;
begin
  if p_mode = 'B' and array_length(p_profiles, 1) <> 1 then
    raise exception 'Una comida individual (B) tiene un solo participante' using errcode = 'check_violation';
  end if;
  if p_mode in ('A', 'C') and coalesce(array_length(p_profiles, 1), 0) < 1 then
    raise exception 'Una comida compartida necesita participantes' using errcode = 'check_violation';
  end if;
  insert into public.meal_events (plan_id, household_id, date, slot, mode, recipe_version_id, batch_id, cook_servings, created_by)
    values (public.ensure_meal_plan(p_household, p_date), p_household, p_date, p_slot, p_mode, p_version, p_batch, p_cook_servings, auth.uid())
    returning id into v_event;
  foreach v_profile in array p_profiles loop
    insert into public.meal_participants (event_id, profile_id, date, slot) values (v_event, v_profile, p_date, p_slot);
  end loop;
  return v_event;
end $$;

-- Aprueba las porciones calculadas por el motor: reemplaza las anteriores del evento,
-- guarda la traza y controla edición concurrente con row_version.
-- SECURITY DEFINER porque escribe la porción de la pareja aunque el usuario solo
-- la vea en nivel "summary"; la membresía al hogar se verifica explícitamente.
create or replace function public.approve_meal_portions(p_event uuid, p_expected_version int, p_portions jsonb, p_run jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_event public.meal_events%rowtype;
  v_run uuid;
  v_p jsonb;
  v_participant uuid;
  v_portion uuid;
  v_line jsonb;
  v_new_version int;
begin
  select * into v_event from public.meal_events where id = p_event for update;
  if not found or not public.is_member(v_event.household_id) then
    raise exception 'Evento no encontrado' using errcode = 'no_data_found';
  end if;
  if v_event.row_version <> p_expected_version then
    raise exception 'La comida cambió mientras la editabas (versión % frente a %)', v_event.row_version, p_expected_version
      using errcode = '40001', hint = 'event_version_conflict';
  end if;

  insert into public.calculation_runs (household_id, profile_id, engine, engine_version, input_hash, inputs, outputs, created_by)
    values (v_event.household_id, null, 'portions', p_run ->> 'engine_version', p_run ->> 'input_hash',
            coalesce(p_run -> 'inputs', '{}'::jsonb), coalesce(p_run -> 'outputs', '{}'::jsonb), auth.uid())
    returning id into v_run;

  for v_p in select * from jsonb_array_elements(p_portions) loop
    select id into v_participant from public.meal_participants
      where event_id = p_event and profile_id = (v_p ->> 'profile_id')::uuid and active;
    if v_participant is null then
      raise exception 'El perfil % no participa en esta comida', v_p ->> 'profile_id' using errcode = 'check_violation';
    end if;
    delete from public.meal_portions where participant_id = v_participant;
    insert into public.meal_portions (
      participant_id, status, confidence, total_g, plate_g, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
      budget, deviations, explanations, calc_run_id, approved_at)
    values (
      v_participant, v_p ->> 'status', v_p ->> 'confidence',
      (v_p ->> 'total_g')::numeric, (v_p ->> 'plate_g')::numeric,
      (v_p ->> 'kcal')::numeric, (v_p ->> 'protein_g')::numeric, (v_p ->> 'carbs_g')::numeric,
      (v_p ->> 'fat_g')::numeric, coalesce((v_p ->> 'fiber_g')::numeric, 0), (v_p ->> 'sodium_mg')::numeric,
      v_p -> 'budget', v_p -> 'deviations', coalesce(v_p -> 'explanations', '[]'::jsonb), v_run, now())
    returning id into v_portion;
    for v_line in select * from jsonb_array_elements(v_p -> 'items') loop
      insert into public.portion_ingredients (portion_id, ingredient_id, kind, label, grams, state, units)
        values (v_portion, nullif(v_line ->> 'ingredient_id', '')::uuid, v_line ->> 'kind', v_line ->> 'label',
                (v_line ->> 'grams')::numeric, v_line ->> 'state', (v_line ->> 'units')::int);
    end loop;
  end loop;

  update public.meal_events set plan_status = 'approved' where id = p_event returning row_version into v_new_version;
  return v_new_version;
end $$;

-- ───────────── Compras ─────────────

-- Reemplaza el contenido de la lista por el resultado de un diff aceptado, en una transacción.
create or replace function public.apply_shopping_items(p_list uuid, p_items jsonb, p_run jsonb default null)
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_household uuid;
  v_run uuid;
  v_n int;
begin
  select household_id into v_household from public.shopping_lists where id = p_list for update;
  if v_household is null then
    raise exception 'Lista no encontrada' using errcode = 'no_data_found';
  end if;
  if p_run is not null then
    insert into public.calculation_runs (household_id, engine, engine_version, input_hash, inputs, outputs, created_by)
      values (v_household, 'shopping', p_run ->> 'engine_version', p_run ->> 'input_hash',
              coalesce(p_run -> 'inputs', '{}'::jsonb), coalesce(p_run -> 'outputs', '{}'::jsonb), auth.uid())
      returning id into v_run;
  end if;
  delete from public.shopping_list_items where list_id = p_list;
  insert into public.shopping_list_items (
    list_id, key, ingredient_id, label, category, state, need_g, available_g, buy_g, checked, checked_g,
    manual, manual_quantity, source_hash, pack_suggestion, estimated_price, position)
  select p_list, x.key, x.ingredient_id, x.label, coalesce(x.category, 'otros'), x.state,
         coalesce(x.need_g, 0), coalesce(x.available_g, 0), coalesce(x.buy_g, 0), coalesce(x.checked, false),
         coalesce(x.checked_g, 0), coalesce(x.manual, false), x.manual_quantity, x.source_hash, x.pack_suggestion,
         x.estimated_price, coalesce(x.position, 0)
  from jsonb_to_recordset(p_items) as x(
    key text, ingredient_id uuid, label text, category text, state text, need_g numeric, available_g numeric,
    buy_g numeric, checked boolean, checked_g numeric, manual boolean, manual_quantity text, source_hash text,
    pack_suggestion jsonb, estimated_price numeric, position int);
  get diagnostics v_n = row_count;
  update public.shopping_lists set updated_at = now(), base_calc_run_id = coalesce(v_run, base_calc_run_id) where id = p_list;
  return v_n;
end $$;

-- ───────────── Lotes ─────────────

create or replace function public.mark_batch_cooked(p_batch uuid, p_cooked_total_g numeric, p_measured boolean, p_cooked_on date default current_date)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.cooking_batches
    set status = 'cooked', cooked_total_g = p_cooked_total_g, measured = p_measured, cooked_on = p_cooked_on
    where id = p_batch;
  if not found then
    raise exception 'Lote no encontrado' using errcode = 'no_data_found';
  end if;
end $$;

grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;
