-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 008 · Aplicar un menú semanal en una sola transacción
--
-- Crea los lotes del día de cocina y las comidas de la semana (con sus
-- participantes y acompañamientos omitidos). Si un tiempo ya está ocupado
-- o algo falla, no queda nada a medias. Corre con los permisos de quien
-- llama: RLS y las funciones existentes aplican igual que desde la app.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.apply_week_menu(p_household uuid, p_batches jsonb, p_events jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_b jsonb;
  v_e jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_batch uuid;
  v_event uuid;
  v_events uuid[] := '{}';
  v_profiles uuid[];
  v_opt record;
begin
  if not public.is_member(p_household) then
    raise exception 'Sin acceso a ese hogar' using errcode = '42501';
  end if;
  if jsonb_typeof(p_batches) <> 'array' or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Formato inválido' using errcode = '22023';
  end if;

  for v_b in select * from jsonb_array_elements(p_batches) loop
    insert into public.cooking_batches (household_id, recipe_version_id, status, planned_for, raw_input, expected_cooked_g, location, frozen, use_by)
      values (p_household, (v_b ->> 'recipe_version_id')::uuid, 'planned', (v_b ->> 'planned_for')::date, v_b -> 'raw_input',
              (v_b ->> 'expected_cooked_g')::numeric, v_b ->> 'location', coalesce((v_b ->> 'frozen')::boolean, false), (v_b ->> 'use_by')::date)
      returning id into v_batch;
    v_keys := v_keys || jsonb_build_object(v_b ->> 'key', v_batch);
  end loop;

  for v_e in select * from jsonb_array_elements(p_events) loop
    select array_agg(x::uuid) into v_profiles from jsonb_array_elements_text(v_e -> 'profiles') x;
    if exists (
      select 1 from public.meal_participants mp
      where mp.profile_id = any (v_profiles) and mp.date = (v_e ->> 'date')::date and mp.slot = v_e ->> 'slot' and mp.active and mp.slot <> 'extra'
    ) then
      raise exception 'El % ya tiene una comida en ese tiempo (%)', v_e ->> 'date', v_e ->> 'slot'
        using errcode = '23505', hint = 'slot_taken';
    end if;
    if v_e ->> 'batch_key' is not null and not (v_keys ? (v_e ->> 'batch_key')) then
      raise exception 'Lote desconocido: %', v_e ->> 'batch_key' using errcode = '22023';
    end if;
    v_event := public.create_meal_event(
      p_household, (v_e ->> 'date')::date, v_e ->> 'slot', v_e ->> 'mode', (v_e ->> 'recipe_version_id')::uuid, v_profiles,
      case when v_e ->> 'batch_key' is null then null else (v_keys ->> (v_e ->> 'batch_key'))::uuid end, null);
    for v_opt in select key, value from jsonb_each(coalesce(v_e -> 'skip_sides', '{}'::jsonb)) loop
      update public.meal_participants set options = options || jsonb_build_object('skip_sides', v_opt.value)
        where event_id = v_event and profile_id = v_opt.key::uuid;
    end loop;
    v_events := v_events || v_event;
  end loop;

  return jsonb_build_object('events', to_jsonb(v_events), 'batches', v_keys);
end $$;
grant execute on function public.apply_week_menu(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.apply_week_menu(uuid, jsonb, jsonb) from anon;
