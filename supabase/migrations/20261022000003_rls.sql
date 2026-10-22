-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 003 · Seguridad por fila
-- Compartir cocina no implica compartir datos de salud:
--   · Lo doméstico (recetas, calendario, compras, inventario, lotes) lo ven y
--     editan todos los integrantes del hogar.
--   · Lo individual (perfil, metas, consumo, mediciones) lo ve su dueño, y el
--     otro integrante solo según visibility_grants: private · summary · full.
--   · Con "summary" se ven gramos de la porción compartida, no macros ni metas.
--   · Las alergias (restricción dura) se comparten con el hogar: sin eso no se
--     puede cocinar con seguridad.
-- ════════════════════════════════════════════════════════════════════════

-- ───────────── Funciones auxiliares (security definer, sin recursión) ─────────────

create or replace function public.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
  )
$$;

create or replace function public.is_owner(p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid()) and m.role = 'owner'
  )
$$;

create or replace function public.shares_household(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members a join public.household_members b on a.household_id = b.household_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  )
$$;

create or replace function public.my_profile_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.nutrition_profiles where user_id = (select auth.uid())
$$;

create or replace function public.profile_household(p_profile uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.nutrition_profiles where id = p_profile
$$;

-- Edita su propio perfil, o un perfil gestionado (sin cuenta) de su hogar.
create or replace function public.can_edit_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.nutrition_profiles p
    where p.id = p_profile
      and (p.user_id = (select auth.uid())
           or (p.user_id is null and public.is_member(p.household_id)))
  )
$$;

create or replace function public.visibility_rank(p_level text) returns int
language sql immutable as $$
  select case p_level when 'full' then 2 when 'summary' then 1 else 0 end
$$;

create or replace function public.can_view_profile(p_profile uuid, p_need text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_edit_profile(p_profile)
      or exists (
        select 1 from public.visibility_grants g
        where g.owner_profile_id = p_profile
          and g.viewer_profile_id in (select public.my_profile_ids())
          and public.visibility_rank(g.level) >= public.visibility_rank(p_need)
      )
$$;

create or replace function public.participant_profile(p_participant uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select profile_id from public.meal_participants where id = p_participant
$$;

create or replace function public.portion_profile(p_portion uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select mp.profile_id from public.meal_portions po join public.meal_participants mp on mp.id = po.participant_id where po.id = p_portion
$$;

create or replace function public.event_household(p_event uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.meal_events where id = p_event
$$;

create or replace function public.recipe_household(p_recipe uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.recipes where id = p_recipe
$$;

create or replace function public.version_household(p_version uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select r.household_id from public.recipe_versions v join public.recipes r on r.id = v.recipe_id where v.id = p_version
$$;

-- Ingrediente legible: global o del hogar. Editable: solo si es del hogar.
create or replace function public.ingredient_scope(p_ingredient uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.ingredients where id = p_ingredient
$$;

-- Nombres de las personas del hogar (sin datos de salud), para la UI.
create or replace function public.household_people(p_household uuid)
returns table (profile_id uuid, display_name text, user_id uuid, is_me boolean, my_view_level text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.user_id, p.user_id = (select auth.uid()),
         case when public.can_edit_profile(p.id) then 'full'
              else coalesce((select g.level from public.visibility_grants g
                             where g.owner_profile_id = p.id and g.viewer_profile_id in (select public.my_profile_ids())
                             order by public.visibility_rank(g.level) desc limit 1), 'private') end
  from public.nutrition_profiles p
  where p.household_id = p_household and public.is_member(p_household)
  order by p.created_at
$$;

-- ───────────── Activar RLS en todas las tablas ─────────────

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ───────────── Personas y hogar ─────────────

create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid()) or public.shares_household(id));
create policy users_insert on public.users for insert to authenticated with check (id = (select auth.uid()));
create policy users_update on public.users for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy households_select on public.households for select to authenticated
  using (public.is_member(id) or created_by = (select auth.uid()));
create policy households_insert on public.households for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy households_update on public.households for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));
create policy households_delete on public.households for delete to authenticated
  using (public.is_owner(id));

-- Las altas de integrantes pasan por create_household / join_household (security definer).
create policy members_select on public.household_members for select to authenticated using (public.is_member(household_id));
create policy members_update on public.household_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy members_delete on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(household_id));

create policy profiles_select on public.nutrition_profiles for select to authenticated using (public.can_view_profile(id, 'full'));
create policy profiles_insert on public.nutrition_profiles for insert to authenticated
  with check (public.is_member(household_id) and (user_id = (select auth.uid()) or user_id is null));
create policy profiles_update on public.nutrition_profiles for update to authenticated
  using (public.can_edit_profile(id)) with check (public.is_member(household_id));
create policy profiles_delete on public.nutrition_profiles for delete to authenticated using (public.can_edit_profile(id));

create policy measurements_all on public.profile_measurements for all to authenticated
  using (public.can_view_profile(profile_id, 'full')) with check (public.can_edit_profile(profile_id));

create policy goals_select on public.nutrition_goals for select to authenticated using (public.can_view_profile(profile_id, 'full'));
create policy goals_write on public.nutrition_goals for insert to authenticated with check (public.can_edit_profile(profile_id));
create policy goals_update on public.nutrition_goals for update to authenticated using (public.can_edit_profile(profile_id)) with check (public.can_edit_profile(profile_id));
create policy goals_delete on public.nutrition_goals for delete to authenticated using (public.can_edit_profile(profile_id));

create policy slot_targets_select on public.meal_slot_targets for select to authenticated
  using (exists (select 1 from public.nutrition_goals g where g.id = goal_id and public.can_view_profile(g.profile_id, 'full')));
create policy slot_targets_write on public.meal_slot_targets for all to authenticated
  using (exists (select 1 from public.nutrition_goals g where g.id = goal_id and public.can_edit_profile(g.profile_id)))
  with check (exists (select 1 from public.nutrition_goals g where g.id = goal_id and public.can_edit_profile(g.profile_id)));

create policy restrictions_select on public.dietary_restrictions for select to authenticated
  using (public.can_view_profile(profile_id, 'full')
         or (severity in ('allergy', 'prescribed_exclusion') and public.is_member(public.profile_household(profile_id))));
create policy restrictions_write on public.dietary_restrictions for all to authenticated
  using (public.can_edit_profile(profile_id)) with check (public.can_edit_profile(profile_id));

create policy preferences_all on public.dietary_preferences for all to authenticated
  using (public.can_view_profile(profile_id, 'full')) with check (public.can_edit_profile(profile_id));

create policy grants_select on public.visibility_grants for select to authenticated
  using (public.can_edit_profile(owner_profile_id) or viewer_profile_id in (select public.my_profile_ids()));
create policy grants_write on public.visibility_grants for all to authenticated
  using (public.can_edit_profile(owner_profile_id))
  with check (public.can_edit_profile(owner_profile_id)
              and public.profile_household(owner_profile_id) = public.profile_household(viewer_profile_id));

create policy calc_select on public.calculation_runs for select to authenticated
  using (public.is_member(household_id) and (profile_id is null or public.can_view_profile(profile_id, 'full')));
create policy calc_insert on public.calculation_runs for insert to authenticated
  with check (public.is_member(household_id) and created_by = (select auth.uid()));

create policy consumption_select on public.consumption_logs for select to authenticated using (public.can_view_profile(profile_id, 'full'));
create policy consumption_write on public.consumption_logs for insert to authenticated with check (public.can_edit_profile(profile_id));
create policy consumption_update on public.consumption_logs for update to authenticated using (public.can_edit_profile(profile_id)) with check (public.can_edit_profile(profile_id));
create policy consumption_delete on public.consumption_logs for delete to authenticated using (public.can_edit_profile(profile_id));

-- ───────────── Catálogos (globales o del hogar) ─────────────

create policy exchange_select on public.exchange_groups for select to authenticated using (household_id is null or public.is_member(household_id));
create policy exchange_write on public.exchange_groups for all to authenticated
  using (household_id is not null and public.is_member(household_id)) with check (household_id is not null and public.is_member(household_id));

create policy ingredients_select on public.ingredients for select to authenticated using (household_id is null or public.is_member(household_id));
create policy ingredients_write on public.ingredients for all to authenticated
  using (household_id is not null and public.is_member(household_id)) with check (household_id is not null and public.is_member(household_id));

create policy nutrition_select on public.ingredient_nutrition for select to authenticated
  using (public.ingredient_scope(ingredient_id) is null or public.is_member(public.ingredient_scope(ingredient_id)));
create policy nutrition_write on public.ingredient_nutrition for all to authenticated
  using (public.is_member(public.ingredient_scope(ingredient_id))) with check (public.is_member(public.ingredient_scope(ingredient_id)));

create policy yields_select on public.ingredient_yields for select to authenticated
  using (public.ingredient_scope(ingredient_id) is null or public.is_member(public.ingredient_scope(ingredient_id)));
create policy yields_write on public.ingredient_yields for all to authenticated
  using (public.is_member(public.ingredient_scope(ingredient_id))) with check (public.is_member(public.ingredient_scope(ingredient_id)));

-- ───────────── Dominio doméstico: todo el hogar ─────────────

do $$
declare t text;
begin
  foreach t in array array['pack_sizes', 'recipes', 'meal_plans', 'meal_events', 'cooking_batches', 'inventory_items', 'shopping_lists'] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id))',
      t || '_household', t);
  end loop;
end $$;

create policy versions_all on public.recipe_versions for all to authenticated
  using (public.is_member(public.recipe_household(recipe_id))) with check (public.is_member(public.recipe_household(recipe_id)));
create policy recipe_lines_all on public.recipe_ingredients for all to authenticated
  using (public.is_member(public.version_household(version_id))) with check (public.is_member(public.version_household(version_id)));

create policy participants_all on public.meal_participants for all to authenticated
  using (public.is_member(public.event_household(event_id))) with check (public.is_member(public.event_household(event_id)));

-- Porción: macros solo con visibilidad "full"; gramos con "summary".
create policy portions_select on public.meal_portions for select to authenticated
  using (public.can_view_profile(public.participant_profile(participant_id), 'full'));
-- Ojo: una política "for all" también habilita SELECT; por eso la escritura se separa por comando.
create policy portions_insert on public.meal_portions for insert to authenticated
  with check (public.is_member(public.profile_household(public.participant_profile(participant_id))));
create policy portions_update on public.meal_portions for update to authenticated
  using (public.can_edit_profile(public.participant_profile(participant_id)))
  with check (public.can_edit_profile(public.participant_profile(participant_id)));
create policy portions_delete on public.meal_portions for delete to authenticated
  using (public.can_edit_profile(public.participant_profile(participant_id)));

create policy portion_lines_select on public.portion_ingredients for select to authenticated
  using (public.can_view_profile(public.portion_profile(portion_id), 'summary'));
create policy portion_lines_insert on public.portion_ingredients for insert to authenticated
  with check (public.is_member(public.profile_household(public.portion_profile(portion_id))));
create policy portion_lines_update on public.portion_ingredients for update to authenticated
  using (public.can_edit_profile(public.portion_profile(portion_id)))
  with check (public.can_edit_profile(public.portion_profile(portion_id)));
create policy portion_lines_delete on public.portion_ingredients for delete to authenticated
  using (public.can_edit_profile(public.portion_profile(portion_id)));

create policy reservations_all on public.inventory_reservations for all to authenticated
  using (exists (select 1 from public.inventory_items i where i.id = inventory_item_id and public.is_member(i.household_id)))
  with check (exists (select 1 from public.inventory_items i where i.id = inventory_item_id and public.is_member(i.household_id)));

create policy allocations_all on public.batch_allocations for all to authenticated
  using (exists (select 1 from public.cooking_batches b where b.id = batch_id and public.is_member(b.household_id)))
  with check (exists (select 1 from public.cooking_batches b where b.id = batch_id and public.is_member(b.household_id)));

create policy list_items_all on public.shopping_list_items for all to authenticated
  using (exists (select 1 from public.shopping_lists l where l.id = list_id and public.is_member(l.household_id)))
  with check (exists (select 1 from public.shopping_lists l where l.id = list_id and public.is_member(l.household_id)));

-- ───────────── Privilegios ─────────────

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update, delete on public.calculation_runs from authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;
