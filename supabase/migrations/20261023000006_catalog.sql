-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 006 · Catálogo base (ingredientes y recetario) + ajustes
--
-- 1. Las tablas dejan de FORZAR RLS para su dueño. Las políticas siguen
--    aplicando a todo el tráfico de la app (roles anon/authenticated); el
--    cambio solo permite que las funciones SECURITY DEFINER funcionen aunque
--    el dueño no tenga BYPASSRLS.
-- 2. Ingredientes globales con identificador estable (catalog_slug).
-- 3. Recetario base: plantillas de solo lectura que cada hogar importa como
--    recetas propias (versionables y optimizables como cualquier otra).
-- 4. Ajustes por hogar de la porción de intercambio de cualquier ingrediente,
--    para calzar con la pauta de cada nutricionista.
-- ════════════════════════════════════════════════════════════════════════

-- ───────────── 1. RLS sin FORCE ─────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I no force row level security', t);
  end loop;
end $$;

-- ───────────── 2. Ingredientes del catálogo ─────────────
alter table public.ingredients add column if not exists catalog_slug text;
create unique index if not exists ingredients_catalog_slug on public.ingredients (catalog_slug) where catalog_slug is not null;
alter table public.ingredients drop constraint if exists ingredients_catalog_is_global;
alter table public.ingredients add constraint ingredients_catalog_is_global check (catalog_slug is null or household_id is null);

-- ───────────── 3. Recetario base ─────────────
create table if not exists public.recipe_catalog (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  category text not null check (category in ('desayunos', 'almuerzos', 'cenas', 'snacks', 'postres', 'preparaciones_base')),
  tags text[] not null default '{}',
  prep_minutes int check (prep_minutes between 0 and 1440),
  servings_nominal numeric(5, 2) not null check (servings_nominal > 0),
  is_homogeneous boolean not null default false,
  expected_cooked_yield_g numeric(8, 1) check (expected_cooked_yield_g > 0),
  instructions text not null,
  -- [{ingredient: <catalog_slug>, grams, state, role, min_g?, max_g?, ratio_group?, integer_unit_g?, note?}]
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  catalog_version int not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.recipe_catalog enable row level security;
drop policy if exists recipe_catalog_read on public.recipe_catalog;
create policy recipe_catalog_read on public.recipe_catalog for select to authenticated using (true);
grant select on public.recipe_catalog to authenticated;

alter table public.recipes add column if not exists catalog_slug text references public.recipe_catalog (slug) on delete set null;
create unique index if not exists recipes_household_catalog on public.recipes (household_id, catalog_slug) where catalog_slug is not null;

-- ───────────── 4. Ajustes de intercambio por hogar ─────────────
create table if not exists public.household_ingredient_overrides (
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  exchange_group_code text,
  exchange_grams numeric(7, 2) check (exchange_grams > 0),
  note text,
  updated_at timestamptz not null default now(),
  primary key (household_id, ingredient_id),
  check ((exchange_group_code is null) = (exchange_grams is null))
);
alter table public.household_ingredient_overrides enable row level security;
drop policy if exists overrides_household on public.household_ingredient_overrides;
create policy overrides_household on public.household_ingredient_overrides for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
grant select, insert, update, delete on public.household_ingredient_overrides to authenticated;

-- ───────────── Importación del recetario a un hogar ─────────────

-- Interna (sin verificación de sesión): la usan create_household y la migración.
create or replace function public._import_catalog_recipes(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  c public.recipe_catalog%rowtype;
  v_recipe uuid;
  v_version uuid;
  v_line jsonb;
  v_ing uuid;
  v_pos int;
  v_count int := 0;
begin
  for c in select * from public.recipe_catalog order by category, name loop
    if exists (select 1 from public.recipes where household_id = p_household and catalog_slug = c.slug) then
      continue;
    end if;
    insert into public.recipes (household_id, name, category, tags, prep_minutes, catalog_slug)
      values (p_household, c.name, c.category, c.tags, c.prep_minutes, c.slug)
      returning id into v_recipe;
    insert into public.recipe_versions (recipe_id, version_no, origin, name, servings_nominal, is_homogeneous,
                                        expected_cooked_yield_g, instructions, change_log)
      values (v_recipe, 1, 'original', c.name, c.servings_nominal, c.is_homogeneous, c.expected_cooked_yield_g,
              c.instructions, '[]'::jsonb)
      returning id into v_version;
    v_pos := 0;
    for v_line in select * from jsonb_array_elements(c.lines) loop
      v_pos := v_pos + 1;
      select id into v_ing from public.ingredients where catalog_slug = v_line ->> 'ingredient';
      if v_ing is null then
        raise exception 'Receta "%": ingrediente de catálogo inexistente "%"', c.slug, v_line ->> 'ingredient';
      end if;
      insert into public.recipe_ingredients (version_id, position, ingredient_id, grams, state, role, min_g, max_g, ratio_group, integer_unit_g, note)
        values (v_version, v_pos, v_ing, (v_line ->> 'grams')::numeric, v_line ->> 'state', coalesce(v_line ->> 'role', 'adjustable'),
                nullif(v_line ->> 'min_g', '')::numeric, nullif(v_line ->> 'max_g', '')::numeric, v_line ->> 'ratio_group',
                nullif(v_line ->> 'integer_unit_g', '')::numeric, v_line ->> 'note');
    end loop;
    update public.recipe_versions set sealed_at = now() where id = v_version;
    update public.recipes set current_version_id = v_version where id = v_recipe;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public._import_catalog_recipes(uuid) from public, anon, authenticated;

-- Pública: un integrante agrega al hogar las recetas del catálogo que le falten.
create or replace function public.import_catalog_recipes(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then
    raise exception 'Sin acceso a ese hogar' using errcode = '42501';
  end if;
  return public._import_catalog_recipes(p_household);
end $$;
grant execute on function public.import_catalog_recipes(uuid) to authenticated;

-- Un hogar nuevo parte con el recetario base cargado.
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
  perform public._import_catalog_recipes(v_household);
  return v_household;
end $$;
