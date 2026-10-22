-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 002 · Reglas de integridad (sección 13 del diseño)
-- Cada regla vive en la base de datos, no solo en la app: así ninguna ruta
-- (UI, IA, script) puede saltársela.
-- ════════════════════════════════════════════════════════════════════════

-- ───────────── Recetas: versiones inmutables una vez selladas ─────────────

create or replace function public.guard_recipe_version_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.sealed_at is not null then
    raise exception 'Las versiones de receta son inmutables; crea una versión nueva'
      using errcode = 'check_violation', hint = 'recipe_version_immutable';
  end if;
  -- Mientras está abierta, solo se permite sellarla o corregir campos propios.
  if new.recipe_id <> old.recipe_id or new.version_no <> old.version_no then
    raise exception 'No se puede mover una versión a otra receta' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger recipe_versions_immutable before update on public.recipe_versions
  for each row execute function public.guard_recipe_version_update();

create or replace function public.guard_recipe_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sealed timestamptz;
  v_id uuid := coalesce(new.version_id, old.version_id);
begin
  select sealed_at into v_sealed from public.recipe_versions where id = v_id;
  if not found then
    return coalesce(new, old); -- la versión se está borrando en cascada
  end if;
  if v_sealed is not null then
    raise exception 'La versión ya está sellada: sus ingredientes no se pueden cambiar'
      using errcode = 'check_violation', hint = 'recipe_version_immutable';
  end if;
  return coalesce(new, old);
end $$;

create trigger recipe_ingredients_guard before insert or update or delete on public.recipe_ingredients
  for each row execute function public.guard_recipe_lines();

create or replace function public.guard_recipe_current_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.current_version_id is not null and not exists (
    select 1 from public.recipe_versions v
    where v.id = new.current_version_id and v.recipe_id = new.id and v.sealed_at is not null
  ) then
    raise exception 'La versión vigente debe pertenecer a la receta y estar sellada' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create constraint trigger recipes_current_version_check after insert or update of current_version_id on public.recipes
  deferrable initially deferred
  for each row execute function public.guard_recipe_current_version();

-- ───────────── Lotes: la suma asignada nunca supera el lote ─────────────

create or replace function public.batch_capacity(p_batch uuid) returns numeric
language sql stable as $$
  select coalesce(cooked_total_g, expected_cooked_g) from public.cooking_batches where id = p_batch
$$;

create or replace function public.guard_batch_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cap numeric;
  v_used numeric;
begin
  -- Bloquea el lote para que dos asignaciones simultáneas no lo sobregiren
  select coalesce(cooked_total_g, expected_cooked_g) into v_cap
  from public.cooking_batches where id = new.batch_id for update;
  if v_cap is null then
    raise exception 'El lote no tiene peso medido ni esperado: no se puede repartir' using errcode = 'check_violation';
  end if;
  select coalesce(sum(grams_cooked), 0) into v_used
  from public.batch_allocations where batch_id = new.batch_id and id <> new.id;
  if v_used + new.grams_cooked > v_cap + 0.001 then
    raise exception 'Las asignaciones (% g) superarían el lote (% g)', round(v_used + new.grams_cooked), round(v_cap)
      using errcode = 'check_violation', hint = 'batch_over_allocated';
  end if;
  return new;
end $$;

create trigger batch_allocations_capacity before insert or update on public.batch_allocations
  for each row execute function public.guard_batch_allocation();

create or replace function public.guard_batch_shrink() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_used numeric;
begin
  if coalesce(new.cooked_total_g, new.expected_cooked_g) is distinct from coalesce(old.cooked_total_g, old.expected_cooked_g) then
    select coalesce(sum(grams_cooked), 0) into v_used from public.batch_allocations where batch_id = new.id;
    if v_used > coalesce(new.cooked_total_g, new.expected_cooked_g, 0) + 0.001 then
      raise exception 'El nuevo peso del lote (% g) es menor que lo ya asignado (% g)',
        round(coalesce(new.cooked_total_g, new.expected_cooked_g, 0)), round(v_used)
        using errcode = 'check_violation', hint = 'batch_over_allocated';
    end if;
  end if;
  return new;
end $$;

create trigger cooking_batches_shrink before update on public.cooking_batches
  for each row execute function public.guard_batch_shrink();

-- ───────────── Inventario: no se reserva lo que no existe ─────────────

create or replace function public.guard_inventory_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_stock numeric;
  v_used numeric;
begin
  select grams into v_stock from public.inventory_items where id = new.inventory_item_id for update;
  select coalesce(sum(grams), 0) into v_used
  from public.inventory_reservations where inventory_item_id = new.inventory_item_id and id <> new.id;
  if v_used + new.grams > v_stock + 0.001 then
    raise exception 'No hay stock suficiente: reservado % g de % g disponibles', round(v_used + new.grams), round(v_stock)
      using errcode = 'check_violation', hint = 'inventory_over_reserved';
  end if;
  return new;
end $$;

create trigger inventory_reservations_stock before insert or update on public.inventory_reservations
  for each row execute function public.guard_inventory_reservation();

create or replace function public.guard_inventory_shrink() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_used numeric;
begin
  if new.grams < old.grams then
    select coalesce(sum(grams), 0) into v_used from public.inventory_reservations where inventory_item_id = new.id;
    if v_used > new.grams + 0.001 then
      raise exception 'Hay % g reservados de este producto; no puede quedar en % g', round(v_used), round(new.grams)
        using errcode = 'check_violation', hint = 'inventory_over_reserved';
    end if;
  end if;
  return new;
end $$;

create trigger inventory_items_shrink before update on public.inventory_items
  for each row execute function public.guard_inventory_shrink();

-- ───────────── Alergias: restricción dura también en la base ─────────────

-- Devuelve el motivo si el ingrediente está vetado para el perfil, o NULL.
create or replace function public.ingredient_block_reason(p_profile uuid, p_ingredient uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when r.ingredient_id is not null then 'restricción: ' || i.name
              else 'contiene ' || r.tag end
  from public.dietary_restrictions r
  join public.ingredients i on i.id = p_ingredient
  where r.profile_id = p_profile
    and r.severity in ('allergy', 'prescribed_exclusion')
    and (r.ingredient_id = i.id
         or (r.tag is not null and lower(r.tag) = any (select lower(t) from unnest(i.allergen_tags) t)))
  limit 1
$$;

-- Ingredientes de la base común (todo menos acompañamientos) que el perfil no puede comer.
create or replace function public.version_block_reason(p_profile uuid, p_version uuid) returns text
language sql stable security definer set search_path = public as $$
  select public.ingredient_block_reason(p_profile, ri.ingredient_id)
  from public.recipe_ingredients ri
  where ri.version_id = p_version and ri.role <> 'side'
    and public.ingredient_block_reason(p_profile, ri.ingredient_id) is not null
  limit 1
$$;

create or replace function public.guard_participant() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_event public.meal_events%rowtype;
  v_reason text;
begin
  select * into v_event from public.meal_events where id = new.event_id;
  -- Desnormalizar fecha y slot desde el evento
  new.date := v_event.date;
  new.slot := v_event.slot;
  if not exists (select 1 from public.nutrition_profiles p where p.id = new.profile_id and p.household_id = v_event.household_id) then
    raise exception 'El perfil no pertenece al hogar del evento' using errcode = 'check_violation';
  end if;
  if new.active and v_event.recipe_version_id is not null then
    v_reason := public.version_block_reason(new.profile_id, v_event.recipe_version_id);
    if v_reason is not null then
      raise exception 'Este perfil no puede comer la base de esta receta (%)', v_reason
        using errcode = 'check_violation', hint = 'allergen_blocked';
    end if;
  end if;
  return new;
end $$;

create trigger meal_participants_guard before insert or update on public.meal_participants
  for each row execute function public.guard_participant();

create or replace function public.guard_event_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_reason text;
  v_profile uuid;
begin
  new.row_version := old.row_version + 1;
  if new.recipe_version_id is distinct from old.recipe_version_id and new.recipe_version_id is not null then
    for v_profile in select profile_id from public.meal_participants where event_id = new.id and active loop
      v_reason := public.version_block_reason(v_profile, new.recipe_version_id);
      if v_reason is not null then
        raise exception 'Un participante no puede comer la base de esta receta (%)', v_reason
          using errcode = 'check_violation', hint = 'allergen_blocked';
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger meal_events_guard before update on public.meal_events
  for each row execute function public.guard_event_change();

-- Mover un evento de fecha o slot mueve a sus participantes (y revalida "una comida por slot")
create or replace function public.propagate_event_slot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.date <> old.date or new.slot <> old.slot then
    update public.meal_participants set date = new.date, slot = new.slot where event_id = new.id;
  end if;
  return null;
end $$;

create trigger meal_events_propagate after update of date, slot on public.meal_events
  for each row execute function public.propagate_event_slot();

create or replace function public.guard_portion_ingredient() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
  v_reason text;
begin
  if new.ingredient_id is null then
    return new;
  end if;
  select mp.profile_id into v_profile
  from public.meal_portions po join public.meal_participants mp on mp.id = po.participant_id
  where po.id = new.portion_id;
  v_reason := public.ingredient_block_reason(v_profile, new.ingredient_id);
  if v_reason is not null then
    raise exception 'Ingrediente incompatible con las restricciones del perfil (%)', v_reason
      using errcode = 'check_violation', hint = 'allergen_blocked';
  end if;
  return new;
end $$;

create trigger portion_ingredients_guard before insert or update on public.portion_ingredients
  for each row execute function public.guard_portion_ingredient();

-- ───────────── Hogar: tope de integrantes ─────────────

create or replace function public.guard_member_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_count int;
begin
  select max_members into v_max from public.households where id = new.household_id for update;
  select count(*) into v_count from public.household_members where household_id = new.household_id;
  if v_count >= v_max then
    raise exception 'El hogar ya tiene % integrantes', v_max using errcode = 'check_violation', hint = 'household_full';
  end if;
  return new;
end $$;

create trigger household_members_limit before insert on public.household_members
  for each row execute function public.guard_member_limit();

-- ───────────── Metas: el reparto por comida suma 100 % ─────────────

create or replace function public.guard_slot_shares() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_goal uuid := coalesce(new.goal_id, old.goal_id);
  v_sum numeric;
  v_n int;
begin
  select coalesce(sum(kcal_share), 0), count(*) into v_sum, v_n from public.meal_slot_targets where goal_id = v_goal;
  if v_n > 0 and abs(v_sum - 1) > 0.001 then
    raise exception 'El reparto por tiempo de comida debe sumar 100 %% (suma %)', round(v_sum * 100, 1)
      using errcode = 'check_violation', hint = 'slot_shares_sum';
  end if;
  return null;
end $$;

create constraint trigger meal_slot_targets_sum after insert or update or delete on public.meal_slot_targets
  deferrable initially deferred
  for each row execute function public.guard_slot_shares();

-- ───────────── Consumo: coherente con el hogar del evento ─────────────

create or replace function public.guard_consumption() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and not exists (
    select 1 from public.meal_events e join public.nutrition_profiles p on p.household_id = e.household_id
    where e.id = new.event_id and p.id = new.profile_id
  ) then
    raise exception 'La comida registrada no pertenece al hogar del perfil' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger consumption_logs_guard before insert or update on public.consumption_logs
  for each row execute function public.guard_consumption();

-- ───────────── Trazas de cálculo: solo se agregan ─────────────

create or replace function public.guard_append_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Las trazas de cálculo no se modifican' using errcode = 'check_violation';
end $$;

create trigger calculation_runs_append_only before update on public.calculation_runs
  for each row execute function public.guard_append_only();
