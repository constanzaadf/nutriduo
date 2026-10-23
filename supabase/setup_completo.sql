-- NutriDuo: instalación completa en un proyecto Supabase NUEVO.
-- Pegar entero en Supabase → SQL Editor → Run. Generado desde supabase/migrations + seed.sql.

-- ═══════════ supabase/migrations/20261022000001_schema.sql ═══════════
-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 001 · Esquema
-- 31 tablas en cuatro dominios: personas y metas · ingredientes y recetas ·
-- planificación y consumo · inventario, lotes y compras.
-- Cantidades siempre en gramos con su estado (raw / cooked / as_sold).
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── Utilidades ───────────────────────────

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Estados físicos de una cantidad
create domain public.food_state as text check (value in ('raw', 'cooked', 'as_sold'));
-- Gramos no negativos
create domain public.grams as numeric(10, 2) check (value >= 0);

-- ═══════════════════ 1. Hogar, personas y metas ═══════════════════

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  timezone text not null default 'America/Santiago',
  currency text not null default 'CLP' check (currency ~ '^[A-Z]{3}$'),
  max_members int not null default 2 check (max_members between 1 and 12),
  invite_code text unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.nutrition_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Usuario dueño del perfil. NULL = perfil gestionado (la otra persona aún no tiene cuenta).
  user_id uuid references auth.users (id) on delete set null,
  managed_by uuid references auth.users (id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  birth_date date,
  -- Constante de la ecuación metabólica (no "sexo"): male, female o average.
  equation_constant text check (equation_constant in ('male', 'female', 'average')),
  height_cm numeric(5, 1) check (height_cm between 120 and 230),
  weight_kg numeric(5, 1) check (weight_kg between 30 and 300),
  body_fat_pct numeric(4, 1) check (body_fat_pct between 3 and 70),
  target_weight_kg numeric(5, 1) check (target_weight_kg between 30 and 300),
  daily_activity text check (daily_activity in ('sedentary', 'office_walking', 'standing', 'physical')),
  daily_pal_override numeric(3, 2) check (daily_pal_override between 1.0 and 2.5),
  work_type text,
  -- [{label, met, minutes, daysOfWeek[], resistance}]
  training jsonb not null default '[]'::jsonb check (jsonb_typeof(training) = 'array'),
  goal_type text check (goal_type in ('fat_loss', 'recomposition', 'muscle_gain', 'maintenance', 'balanced', 'custom')),
  goal_note text,
  clinical_flags text[] not null default '{}' check (clinical_flags <@ array['pregnancy', 'lactation', 'medical_condition']),
  cooking_preferences text,
  professional_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (id, household_id)
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  profile_id uuid references public.nutrition_profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table public.profile_measurements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  measured_on date not null,
  weight_kg numeric(5, 1) check (weight_kg between 30 and 300),
  body_fat_pct numeric(4, 1) check (body_fat_pct between 3 and 70),
  waist_cm numeric(5, 1) check (waist_cm between 40 and 250),
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, measured_on)
);

create table public.calculation_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  profile_id uuid references public.nutrition_profiles (id) on delete cascade,
  engine text not null check (engine in ('goals', 'portions', 'shopping', 'evaluation')),
  engine_version text not null,
  input_hash text,
  inputs jsonb not null,
  outputs jsonb not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.nutrition_goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  mode text not null default 'macros' check (mode in ('macros', 'exchanges')),
  source text not null check (source in ('calculated', 'prescribed', 'manual')),
  confidence text not null check (confidence in ('prescribed', 'calculated', 'estimated')),
  kcal numeric(7, 1) not null check (kcal between 800 and 6000),
  protein_g numeric(6, 1) not null check (protein_g >= 0),
  carbs_g numeric(6, 1) not null check (carbs_g >= 0),
  fat_g numeric(6, 1) not null check (fat_g >= 0),
  fiber_g numeric(5, 1) check (fiber_g >= 0),
  -- Metas diarias en porciones de intercambio (modo pauta): {"cereales": 6, ...}
  exchange_portions jsonb,
  -- Metas por día de la semana (opcional): [{kcal, protein_g, ...} × 7]
  by_weekday jsonb,
  prescribed_by text,
  valid_from date not null default current_date,
  valid_to date,
  calc_run_id uuid references public.calculation_runs (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (mode = 'macros' or exchange_portions is not null)
);
-- Una sola meta vigente por perfil
create unique index nutrition_goals_one_current on public.nutrition_goals (profile_id) where valid_to is null;

create table public.meal_slot_targets (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.nutrition_goals (id) on delete cascade,
  slot text not null check (slot in ('breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner', 'extra')),
  kcal_share numeric(4, 3) not null check (kcal_share between 0 and 1),
  exchange_portions jsonb,
  unique (goal_id, slot)
);

create table public.exchange_groups (
  id uuid primary key default gen_random_uuid(),
  -- NULL = tabla global por defecto; con hogar = valores de la pauta de ese hogar
  household_id uuid references public.households (id) on delete cascade,
  code text not null,
  label text not null,
  kcal numeric(6, 1) not null check (kcal >= 0),
  protein_g numeric(5, 1) not null check (protein_g >= 0),
  carbs_g numeric(5, 1) not null check (carbs_g >= 0),
  fat_g numeric(5, 1) not null check (fat_g >= 0),
  reference text,
  confidence text not null default 'estimated' check (confidence in ('prescribed', 'calculated', 'estimated'))
);
create unique index exchange_groups_scope_code on public.exchange_groups (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table public.visibility_grants (
  owner_profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  viewer_profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  level text not null default 'summary' check (level in ('private', 'summary', 'full')),
  updated_at timestamptz not null default now(),
  primary key (owner_profile_id, viewer_profile_id),
  check (owner_profile_id <> viewer_profile_id)
);

-- ═══════════════════ 2. Ingredientes y recetas ═══════════════════

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  -- NULL = catálogo global; con hogar = ingrediente propio
  household_id uuid references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  category text not null default 'otros' check (category in (
    'carnes', 'pescados', 'huevos', 'lacteos', 'cereales', 'legumbres', 'verduras', 'frutas',
    'grasas', 'frutos_secos', 'condimentos', 'panaderia', 'bebidas', 'otros')),
  default_state public.food_state not null default 'raw',
  unit_weight_g numeric(7, 2) check (unit_weight_g > 0),
  density_g_per_ml numeric(5, 3) check (density_g_per_ml > 0),
  exchange_group_code text,
  exchange_grams numeric(7, 2) check (exchange_grams > 0),
  exchange_state public.food_state,
  allergen_tags text[] not null default '{}',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((exchange_group_code is null) = (exchange_grams is null))
);
create unique index ingredients_scope_name on public.ingredients (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table public.ingredient_nutrition (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  state public.food_state not null,
  kcal numeric(6, 1) not null check (kcal between 0 and 950),
  protein_g numeric(5, 2) not null check (protein_g between 0 and 100),
  carbs_g numeric(5, 2) not null check (carbs_g between 0 and 100),
  fat_g numeric(5, 2) not null check (fat_g between 0 and 100),
  fiber_g numeric(5, 2) not null default 0 check (fiber_g between 0 and 100),
  sodium_mg numeric(7, 1) check (sodium_mg >= 0),
  source text not null check (source in ('fdc', 'label', 'manual', 'exchange_table')),
  source_ref text,
  confidence text not null default 'calculated' check (confidence in ('prescribed', 'calculated', 'estimated')),
  created_at timestamptz not null default now(),
  unique (ingredient_id, state),
  check (protein_g + carbs_g + fat_g <= 100.5)
);

create table public.ingredient_yields (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  method text not null default 'default',
  yield_factor numeric(5, 3) not null check (yield_factor between 0.1 and 5),
  unique (ingredient_id, method)
);

create table public.pack_sizes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  grams numeric(8, 1) not null check (grams > 0),
  label text not null,
  price numeric(12, 2) check (price >= 0),
  unique (household_id, ingredient_id, grams)
);

-- Restricciones y preferencias (dependen de ingredientes, por eso viven aquí)
create table public.dietary_restrictions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  tag text,
  -- allergy y prescribed_exclusion son restricciones duras (motor y base de datos);
  -- intolerance y avoid se respetan en el motor y en las sugerencias.
  severity text not null check (severity in ('allergy', 'prescribed_exclusion', 'intolerance', 'avoid')),
  note text,
  created_at timestamptz not null default now(),
  check ((ingredient_id is null) <> (tag is null))
);
create unique index dietary_restrictions_unique on public.dietary_restrictions (profile_id, coalesce(ingredient_id::text, lower(tag)));

create table public.dietary_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  tag text,
  -- -1 = le encanta … +1 = no le gusta
  score numeric(3, 2) not null check (score between -1 and 1),
  created_at timestamptz not null default now(),
  check ((ingredient_id is null) <> (tag is null))
);
create unique index dietary_preferences_unique on public.dietary_preferences (profile_id, coalesce(ingredient_id::text, lower(tag)));

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  category text not null default 'almuerzos' check (category in ('desayunos', 'almuerzos', 'cenas', 'snacks', 'postres', 'preparaciones_base')),
  tags text[] not null default '{}',
  photo_path text,
  prep_minutes int check (prep_minutes between 0 and 1440),
  favorite boolean not null default false,
  archived boolean not null default false,
  current_version_id uuid,
  source_url text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  parent_version_id uuid references public.recipe_versions (id),
  version_no int not null check (version_no >= 1),
  origin text not null default 'original' check (origin in ('original', 'optimized', 'manual')),
  name text not null,
  servings_nominal numeric(5, 2) not null check (servings_nominal > 0),
  is_homogeneous boolean not null default false,
  expected_cooked_yield_g numeric(8, 1) check (expected_cooked_yield_g > 0),
  instructions text,
  -- Cambios respecto de la versión padre y su justificación (versiones optimizadas)
  change_log jsonb not null default '[]'::jsonb,
  sealed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (recipe_id, version_no)
);

alter table public.recipes
  add constraint recipes_current_version_fk foreign key (current_version_id) references public.recipe_versions (id) deferrable initially deferred;

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.recipe_versions (id) on delete cascade,
  position int not null,
  ingredient_id uuid not null references public.ingredients (id),
  grams public.grams not null check (grams > 0),
  state public.food_state not null,
  role text not null default 'adjustable' check (role in ('fixed', 'adjustable', 'ratio', 'side')),
  min_g public.grams,
  max_g public.grams,
  ratio_group text,
  integer_unit_g numeric(7, 2) check (integer_unit_g > 0),
  note text,
  unique (version_id, position),
  check (min_g is null or max_g is null or min_g <= max_g),
  check ((role = 'ratio') = (ratio_group is not null))
);

-- ═══════════════════ 3. Planificación y consumo ═══════════════════

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  iso_week text not null check (iso_week ~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$'),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  is_favorite boolean not null default false,
  favorite_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, iso_week),
  unique (id, household_id)
);

create table public.cooking_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions (id),
  status text not null default 'planned' check (status in ('planned', 'cooked', 'finished', 'discarded')),
  planned_for date,
  cooked_on date,
  -- Ingredientes crudos que entran a la olla: [{ingredientId, grams, state}]
  raw_input jsonb not null default '[]'::jsonb check (jsonb_typeof(raw_input) = 'array'),
  expected_cooked_g numeric(8, 1) check (expected_cooked_g > 0),
  cooked_total_g numeric(8, 1) check (cooked_total_g > 0),
  measured boolean not null default false,
  location text not null default 'fridge' check (location in ('fridge', 'freezer', 'pantry')),
  frozen boolean not null default false,
  use_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not measured or cooked_total_g is not null),
  check (status <> 'cooked' or cooked_total_g is not null or expected_cooked_g is not null),
  unique (id, household_id)
);

create table public.meal_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  household_id uuid not null,
  date date not null,
  slot text not null check (slot in ('breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner', 'extra')),
  mode text not null check (mode in ('A', 'B', 'C')),
  recipe_version_id uuid references public.recipe_versions (id),
  batch_id uuid references public.cooking_batches (id) on delete set null,
  plan_status text not null default 'draft' check (plan_status in ('draft', 'approved', 'eaten_out', 'cancelled')),
  prep_status text not null default 'pending' check (prep_status in ('pending', 'prepared')),
  -- Cocinar porciones extra para que sobre (null = lo justo)
  cook_servings numeric(5, 2) check (cook_servings > 0),
  row_version int not null default 1,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, household_id) references public.meal_plans (id, household_id) on delete cascade,
  check (plan_status in ('eaten_out', 'cancelled') or recipe_version_id is not null)
);
create index meal_events_household_date on public.meal_events (household_id, date);

create table public.meal_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.meal_events (id) on delete cascade,
  profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  -- Desnormalizado desde el evento para garantizar una comida principal por perfil y slot
  date date not null,
  slot text not null,
  active boolean not null default true,
  -- Ajustes individuales (modalidad C): {"extras":[{ingredient_id, grams, state, integer_unit_g}], "skip_sides":[ingredient_id]}
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  unique (event_id, profile_id)
);
create unique index meal_participants_one_per_slot on public.meal_participants (profile_id, date, slot) where active and slot <> 'extra';

create table public.meal_portions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.meal_participants (id) on delete cascade,
  status text not null check (status in ('within_tolerance', 'with_deviation', 'outside_prescribed_tolerance', 'manual')),
  confidence text not null check (confidence in ('prescribed', 'calculated', 'estimated')),
  total_g numeric(8, 1) not null check (total_g >= 0),
  plate_g numeric(8, 1) check (plate_g >= 0),
  kcal numeric(7, 1) not null check (kcal >= 0),
  protein_g numeric(6, 1) not null check (protein_g >= 0),
  carbs_g numeric(6, 1) not null check (carbs_g >= 0),
  fat_g numeric(6, 1) not null check (fat_g >= 0),
  fiber_g numeric(5, 1) not null default 0 check (fiber_g >= 0),
  sodium_mg numeric(7, 1),
  budget jsonb,
  deviations jsonb,
  explanations jsonb not null default '[]'::jsonb,
  calc_run_id uuid references public.calculation_runs (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.portion_ingredients (
  id uuid primary key default gen_random_uuid(),
  portion_id uuid not null references public.meal_portions (id) on delete cascade,
  -- NULL = mezcla de una preparación homogénea
  ingredient_id uuid references public.ingredients (id),
  kind text not null check (kind in ('line', 'mix', 'extra')),
  label text not null,
  grams public.grams not null,
  state public.food_state not null,
  units int check (units >= 0),
  check ((kind = 'mix') = (ingredient_id is null))
);

create table public.consumption_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nutrition_profiles (id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner', 'extra')),
  event_id uuid references public.meal_events (id) on delete set null,
  kind text not null check (kind in ('as_planned', 'modified_portion', 'different_meal', 'eaten_out', 'skipped')),
  portion_factor numeric(4, 2) check (portion_factor between 0 and 4),
  kcal numeric(7, 1) check (kcal >= 0),
  protein_g numeric(6, 1) check (protein_g >= 0),
  carbs_g numeric(6, 1) check (carbs_g >= 0),
  fat_g numeric(6, 1) check (fat_g >= 0),
  fiber_g numeric(5, 1) check (fiber_g >= 0),
  confidence text not null default 'estimated' check (confidence in ('prescribed', 'calculated', 'estimated')),
  free_text text,
  created_at timestamptz not null default now(),
  check (kind <> 'modified_portion' or portion_factor is not null),
  check (kind <> 'skipped' or coalesce(kcal, 0) = 0)
);
-- Nunca dos registros para la misma comida planificada del mismo perfil
create unique index consumption_one_per_event on public.consumption_logs (profile_id, event_id) where event_id is not null;
create index consumption_profile_date on public.consumption_logs (profile_id, date);

-- ═══════════════════ 4. Inventario, lotes y compras ═══════════════════

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  grams public.grams not null,
  state public.food_state not null,
  location text not null default 'pantry' check (location in ('pantry', 'fridge', 'freezer')),
  expires_on date,
  opened boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  event_id uuid references public.meal_events (id) on delete cascade,
  batch_id uuid references public.cooking_batches (id) on delete cascade,
  grams public.grams not null check (grams > 0),
  created_at timestamptz not null default now(),
  check ((event_id is null) <> (batch_id is null))
);

create table public.batch_allocations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.cooking_batches (id) on delete cascade,
  event_id uuid references public.meal_events (id) on delete cascade,
  participant_id uuid references public.meal_participants (id) on delete cascade,
  -- Gramos de preparación terminada (cocida), nunca crudos
  grams_cooked public.grams not null check (grams_cooked > 0),
  destination text not null default 'meal' check (destination in ('meal', 'freezer', 'fridge')),
  consumed boolean not null default false,
  created_at timestamptz not null default now(),
  check (destination <> 'meal' or event_id is not null)
);

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  plan_id uuid references public.meal_plans (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  base_calc_run_id uuid references public.calculation_runs (id) on delete set null,
  budget numeric(12, 2) check (budget >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index shopping_one_active_per_plan on public.shopping_lists (plan_id) where status = 'active' and plan_id is not null;

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  key text not null,
  ingredient_id uuid references public.ingredients (id),
  label text not null,
  category text not null default 'otros',
  state public.food_state,
  need_g public.grams not null default 0,
  available_g public.grams not null default 0,
  buy_g public.grams not null default 0,
  checked boolean not null default false,
  checked_g public.grams not null default 0,
  manual boolean not null default false,
  manual_quantity text,
  source_hash text,
  pack_suggestion jsonb,
  estimated_price numeric(12, 2) check (estimated_price >= 0),
  position int not null default 0,
  updated_at timestamptz not null default now(),
  unique (list_id, key),
  check (manual or ingredient_id is not null)
);

-- ─────────────────────────── updated_at ───────────────────────────
do $$
declare t text;
begin
  foreach t in array array['users', 'households', 'nutrition_profiles', 'ingredients', 'recipes', 'meal_plans',
                           'meal_events', 'cooking_batches', 'inventory_items', 'shopping_lists', 'shopping_list_items', 'visibility_grants']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', 'touch_' || t, t);
  end loop;
end $$;

-- ═══════════ supabase/migrations/20261022000002_integrity.sql ═══════════
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

-- ═══════════ supabase/migrations/20261022000003_rls.sql ═══════════
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

-- ═══════════ supabase/migrations/20261022000004_functions.sql ═══════════
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
            jsonb_set(coalesce(p_run -> 'inputs', '{}'::jsonb), '{event_id}', to_jsonb(p_event::text)),
            coalesce(p_run -> 'outputs', '{}'::jsonb), auth.uid())
    returning id into v_run;

  -- Si la comida sale de un lote, sus asignaciones se rehacen junto con las porciones
  if v_event.batch_id is not null then
    delete from public.batch_allocations where event_id = p_event;
  end if;

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
      if v_event.batch_id is not null and v_line ->> 'kind' = 'mix' and (v_line ->> 'grams')::numeric > 0 then
        insert into public.batch_allocations (batch_id, event_id, participant_id, grams_cooked)
          values (v_event.batch_id, p_event, v_participant, (v_line ->> 'grams')::numeric);
      end if;
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


-- Gramos de las porciones de un conjunto de comidas, respetando la visibilidad
-- "summary": se ven las líneas de la pareja aunque su fila de macros no sea visible.
create or replace function public.event_portion_lines(p_events uuid[])
returns table (event_id uuid, participant_id uuid, profile_id uuid, label text, grams numeric, kind text, state text, units int)
language sql stable security definer set search_path = public as $$
  select mp.event_id, mp.id, mp.profile_id, pi.label, pi.grams, pi.kind, pi.state::text, pi.units
  from public.meal_participants mp
  join public.meal_events e on e.id = mp.event_id
  join public.meal_portions po on po.participant_id = mp.id
  join public.portion_ingredients pi on pi.portion_id = po.id
  where mp.event_id = any (p_events)
    and mp.active
    and public.is_member(e.household_id)
    and public.can_view_profile(mp.profile_id, 'summary')
  order by mp.event_id, mp.id, pi.kind, pi.grams desc
$$;

grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;

-- ═══════════ supabase/migrations/20261022000005_storage.sql ═══════════
-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 005 · Almacenamiento (fotos de recetas, pautas importadas)
-- Rutas: <household_id>/recipes/<archivo> · <household_id>/plans/<profile_id>/<archivo>
-- Solo aplica si existe el esquema storage (proyecto Supabase real).
-- ════════════════════════════════════════════════════════════════════════
do $outer$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'Sin esquema storage: se omite (entorno de pruebas)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
    values ('household-files', 'household-files', false)
    on conflict (id) do nothing;

  execute $p$
    create policy household_files_read on storage.objects for select to authenticated
    using (bucket_id = 'household-files'
           and public.is_member(((storage.foldername(name))[1])::uuid)
           and ((storage.foldername(name))[2] <> 'plans'
                or public.can_view_profile(((storage.foldername(name))[3])::uuid, 'full')))
  $p$;
  execute $p$
    create policy household_files_write on storage.objects for insert to authenticated
    with check (bucket_id = 'household-files'
                and public.is_member(((storage.foldername(name))[1])::uuid)
                and ((storage.foldername(name))[2] <> 'plans'
                     or public.can_edit_profile(((storage.foldername(name))[3])::uuid)))
  $p$;
  execute $p$
    create policy household_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'household-files'
           and public.is_member(((storage.foldername(name))[1])::uuid)
           and ((storage.foldername(name))[2] <> 'plans'
                or public.can_edit_profile(((storage.foldername(name))[3])::uuid)))
  $p$;
end
$outer$;

-- ═══════════ supabase/migrations/20261023000006_catalog.sql ═══════════
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

-- ═══════════ supabase/migrations/20261023000007_catalog_data.sql ═══════════
-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 007 · Datos del catálogo base (GENERADO: no editar a mano)
-- Generado por packages/catalog/scripts/generate-sql.ts
-- Fuente nutricional: USDA National Nutrient Database for Standard Reference, Release 28 (SR28), archivo abreviado ABBREV.txt
-- Huella del archivo fuente (sha256): 4c42235a001efd5e94ce38001682138056aa1b755427b8a8d315c2b02cd2b85b
-- 94 ingredientes · 37 recetas
-- ════════════════════════════════════════════════════════════════════════

-- Si ya existía un ingrediente global con el mismo nombre (cargado a mano), se adopta
update public.ingredients i set catalog_slug = v.slug
from (values
  ('pechuga-pollo', 'Pechuga de pollo sin piel'),
  ('trutro-pollo', 'Trutro de pollo deshuesado sin piel'),
  ('carne-molida-5', 'Carne molida 5 % grasa'),
  ('carne-molida-10', 'Carne molida 10 % grasa'),
  ('posta-negra', 'Posta negra (vacuno magro)'),
  ('carne-guisar', 'Carne magra para guisar (sobrecostilla)'),
  ('huevo', 'Huevo'),
  ('clara-huevo', 'Clara de huevo'),
  ('proteina-whey', 'Proteína de suero en polvo (whey)'),
  ('leche-descremada', 'Leche descremada'),
  ('leche-semidescremada', 'Leche semidescremada'),
  ('yogur-natural', 'Yogur natural descremado'),
  ('yogur-griego', 'Yogur griego natural descremado'),
  ('queso-cottage', 'Queso cottage 1 %'),
  ('ricotta', 'Ricotta semidescremada'),
  ('queso-gauda', 'Queso gauda / mantecoso'),
  ('queso-parmesano', 'Queso parmesano rallado'),
  ('queso-mozzarella', 'Queso mozzarella semidescremado'),
  ('mantequilla', 'Mantequilla sin sal'),
  ('avena', 'Avena en hojuelas'),
  ('arroz', 'Arroz blanco grano largo'),
  ('arroz-integral', 'Arroz integral'),
  ('fideos', 'Fideos / pasta seca'),
  ('fideos-integrales', 'Fideos integrales'),
  ('cuscus', 'Cuscús'),
  ('harina', 'Harina de trigo'),
  ('pan-integral', 'Pan integral de molde'),
  ('pan-frances', 'Pan blanco tipo marraqueta'),
  ('pan-hamburguesa', 'Pan de hamburguesa'),
  ('tortilla-harina', 'Tortilla de harina (wrap)'),
  ('papa', 'Papa'),
  ('camote', 'Camote'),
  ('choclo', 'Choclo (granos)'),
  ('arvejas', 'Arvejas'),
  ('lentejas', 'Lentejas'),
  ('garbanzos', 'Garbanzos'),
  ('porotos-negros', 'Porotos negros'),
  ('porotos', 'Porotos (tipo coscorrón)'),
  ('cebolla', 'Cebolla'),
  ('ajo', 'Ajo'),
  ('tomate', 'Tomate'),
  ('tomate-conserva', 'Tomate en conserva'),
  ('salsa-tomate', 'Salsa de tomate (passata)'),
  ('zanahoria', 'Zanahoria'),
  ('zapallo-italiano', 'Zapallo italiano'),
  ('zapallo-camote', 'Zapallo camote'),
  ('pimenton-rojo', 'Pimentón rojo'),
  ('pimenton-verde', 'Pimentón verde'),
  ('lechuga', 'Lechuga'),
  ('espinaca', 'Espinaca'),
  ('acelga', 'Acelga'),
  ('brocoli', 'Brócoli'),
  ('coliflor', 'Coliflor'),
  ('champinones', 'Champiñones'),
  ('pepino', 'Pepino'),
  ('apio', 'Apio'),
  ('repollo', 'Repollo'),
  ('betarraga', 'Betarraga'),
  ('porotos-verdes', 'Porotos verdes'),
  ('cilantro', 'Cilantro'),
  ('perejil', 'Perejil'),
  ('albahaca', 'Albahaca'),
  ('palta', 'Palta Hass'),
  ('platano', 'Plátano'),
  ('manzana', 'Manzana'),
  ('naranja', 'Naranja'),
  ('frutillas', 'Frutillas'),
  ('arandanos', 'Arándanos'),
  ('frambuesas', 'Frambuesas'),
  ('kiwi', 'Kiwi'),
  ('pera', 'Pera'),
  ('durazno', 'Durazno'),
  ('jugo-limon', 'Jugo de limón'),
  ('aceite-oliva', 'Aceite de oliva'),
  ('aceite-vegetal', 'Aceite vegetal (maravilla)'),
  ('almendras', 'Almendras'),
  ('nueces', 'Nueces'),
  ('mantequilla-mani', 'Mantequilla de maní'),
  ('chia', 'Semillas de chía'),
  ('miel', 'Miel'),
  ('azucar', 'Azúcar'),
  ('cacao', 'Cacao amargo en polvo'),
  ('sal', 'Sal'),
  ('pimienta', 'Pimienta negra'),
  ('comino', 'Comino'),
  ('oregano', 'Orégano'),
  ('aji-color', 'Ají de color (pimentón dulce)'),
  ('aji-cayena', 'Ají en polvo (cayena)'),
  ('canela', 'Canela molida'),
  ('salsa-soya', 'Salsa de soya'),
  ('vinagre', 'Vinagre'),
  ('mostaza', 'Mostaza'),
  ('polvos-hornear', 'Polvos de hornear'),
  ('caldo-verduras', 'Caldo de verduras')
) as v(slug, name)
where i.household_id is null and i.catalog_slug is null and lower(i.name) = lower(v.name)
  and not exists (select 1 from public.ingredients x where x.catalog_slug = v.slug);

insert into public.ingredients (household_id, catalog_slug, name, category, default_state, unit_weight_g, exchange_group_code, exchange_grams, exchange_state, allergen_tags)
select null, v.slug, v.name, v.category, v.state, v.unit_g::numeric, v.ex_group, v.ex_grams::numeric, v.ex_state, v.allergens
from (values
  ('pechuga-pollo', 'Pechuga de pollo sin piel', 'carnes', 'raw', null, 'carnes_bajas_grasa', 49, 'raw', '{}'::text[]),
  ('trutro-pollo', 'Trutro de pollo deshuesado sin piel', 'carnes', 'raw', null, 'carnes_bajas_grasa', 56, 'raw', '{}'::text[]),
  ('carne-molida-5', 'Carne molida 5 % grasa', 'carnes', 'raw', null, 'carnes_bajas_grasa', 51, 'raw', '{}'::text[]),
  ('carne-molida-10', 'Carne molida 10 % grasa', 'carnes', 'raw', null, 'carnes_altas_grasa', 55, 'raw', '{}'::text[]),
  ('posta-negra', 'Posta negra (vacuno magro)', 'carnes', 'raw', null, 'carnes_bajas_grasa', 47, 'raw', '{}'::text[]),
  ('carne-guisar', 'Carne magra para guisar (sobrecostilla)', 'carnes', 'raw', null, 'carnes_bajas_grasa', 50, 'raw', '{}'::text[]),
  ('huevo', 'Huevo', 'huevos', 'raw', 50, 'carnes_altas_grasa', 88, 'raw', array['huevo']::text[]),
  ('clara-huevo', 'Clara de huevo', 'huevos', 'raw', 33, 'carnes_bajas_grasa', 101, 'raw', array['huevo']::text[]),
  ('proteina-whey', 'Proteína de suero en polvo (whey)', 'otros', 'as_sold', null, 'carnes_bajas_grasa', 14, 'as_sold', array['lactosa']::text[]),
  ('leche-descremada', 'Leche descremada', 'lacteos', 'as_sold', null, 'lacteos_bajos_grasa', 206, 'as_sold', array['lactosa']::text[]),
  ('leche-semidescremada', 'Leche semidescremada', 'lacteos', 'as_sold', null, 'lacteos_medios_grasa', 202, 'as_sold', array['lactosa']::text[]),
  ('yogur-natural', 'Yogur natural descremado', 'lacteos', 'as_sold', null, 'lacteos_bajos_grasa', 125, 'as_sold', array['lactosa']::text[]),
  ('yogur-griego', 'Yogur griego natural descremado', 'lacteos', 'as_sold', null, 'lacteos_bajos_grasa', 119, 'as_sold', array['lactosa']::text[]),
  ('queso-cottage', 'Queso cottage 1 %', 'lacteos', 'as_sold', null, 'carnes_bajas_grasa', 89, 'as_sold', array['lactosa']::text[]),
  ('ricotta', 'Ricotta semidescremada', 'lacteos', 'as_sold', null, 'carnes_altas_grasa', 97, 'as_sold', array['lactosa']::text[]),
  ('queso-gauda', 'Queso gauda / mantecoso', 'lacteos', 'as_sold', null, 'carnes_altas_grasa', 44, 'as_sold', array['lactosa']::text[]),
  ('queso-parmesano', 'Queso parmesano rallado', 'lacteos', 'as_sold', null, 'carnes_altas_grasa', 39, 'as_sold', array['lactosa']::text[]),
  ('queso-mozzarella', 'Queso mozzarella semidescremado', 'lacteos', 'as_sold', null, 'carnes_altas_grasa', 45, 'as_sold', array['lactosa']::text[]),
  ('mantequilla', 'Mantequilla sin sal', 'grasas', 'as_sold', null, 'aceites_grasas', 25, 'as_sold', array['lactosa']::text[]),
  ('avena', 'Avena en hojuelas', 'cereales', 'raw', null, 'cereales', 44, 'raw', array['gluten']::text[]),
  ('arroz', 'Arroz blanco grano largo', 'cereales', 'raw', null, 'cereales', 38, 'raw', '{}'::text[]),
  ('arroz-integral', 'Arroz integral', 'cereales', 'raw', null, 'cereales', 39, 'raw', '{}'::text[]),
  ('fideos', 'Fideos / pasta seca', 'cereales', 'raw', null, 'cereales', 40, 'raw', array['gluten']::text[]),
  ('fideos-integrales', 'Fideos integrales', 'cereales', 'raw', null, 'cereales', 41, 'raw', array['gluten']::text[]),
  ('cuscus', 'Cuscús', 'cereales', 'raw', null, 'cereales', 39, 'raw', array['gluten']::text[]),
  ('harina', 'Harina de trigo', 'cereales', 'as_sold', null, 'cereales', 39, 'as_sold', array['gluten']::text[]),
  ('pan-integral', 'Pan integral de molde', 'panaderia', 'as_sold', 32, 'cereales', 70, 'as_sold', array['gluten']::text[]),
  ('pan-frances', 'Pan blanco tipo marraqueta', 'panaderia', 'as_sold', null, 'cereales', 58, 'as_sold', array['gluten']::text[]),
  ('pan-hamburguesa', 'Pan de hamburguesa', 'panaderia', 'as_sold', 44, 'cereales', 60, 'as_sold', array['gluten']::text[]),
  ('tortilla-harina', 'Tortilla de harina (wrap)', 'panaderia', 'as_sold', 48, 'cereales', 61, 'as_sold', array['gluten']::text[]),
  ('papa', 'Papa', 'verduras', 'raw', null, 'cereales', 172, 'raw', '{}'::text[]),
  ('camote', 'Camote', 'verduras', 'raw', null, 'cereales', 149, 'raw', '{}'::text[]),
  ('choclo', 'Choclo (granos)', 'verduras', 'raw', null, 'cereales', 160, 'raw', '{}'::text[]),
  ('arvejas', 'Arvejas', 'verduras', 'raw', null, 'cereales', 220, 'raw', '{}'::text[]),
  ('lentejas', 'Lentejas', 'legumbres', 'raw', null, 'legumbres', 47, 'raw', '{}'::text[]),
  ('garbanzos', 'Garbanzos', 'legumbres', 'raw', null, 'legumbres', 48, 'raw', '{}'::text[]),
  ('porotos-negros', 'Porotos negros', 'legumbres', 'raw', null, 'legumbres', 48, 'raw', '{}'::text[]),
  ('porotos', 'Porotos (tipo coscorrón)', 'legumbres', 'raw', null, 'legumbres', 50, 'raw', '{}'::text[]),
  ('cebolla', 'Cebolla', 'verduras', 'raw', null, 'verduras_general', 54, 'raw', '{}'::text[]),
  ('ajo', 'Ajo', 'verduras', 'raw', null, null, null, null, '{}'::text[]),
  ('tomate', 'Tomate', 'verduras', 'raw', null, 'verduras_general', 129, 'raw', '{}'::text[]),
  ('tomate-conserva', 'Tomate en conserva', 'verduras', 'as_sold', null, 'verduras_general', 144, 'as_sold', '{}'::text[]),
  ('salsa-tomate', 'Salsa de tomate (passata)', 'verduras', 'as_sold', null, 'verduras_general', 94, 'as_sold', '{}'::text[]),
  ('zanahoria', 'Zanahoria', 'verduras', 'raw', null, 'verduras_general', 52, 'raw', '{}'::text[]),
  ('zapallo-italiano', 'Zapallo italiano', 'verduras', 'raw', null, 'verduras_libre', 80, 'raw', '{}'::text[]),
  ('zapallo-camote', 'Zapallo camote', 'verduras', 'raw', null, 'verduras_general', 43, 'raw', '{}'::text[]),
  ('pimenton-rojo', 'Pimentón rojo', 'verduras', 'raw', null, 'verduras_general', 83, 'raw', '{}'::text[]),
  ('pimenton-verde', 'Pimentón verde', 'verduras', 'raw', null, 'verduras_libre', 54, 'raw', '{}'::text[]),
  ('lechuga', 'Lechuga', 'verduras', 'raw', null, 'verduras_libre', 76, 'raw', '{}'::text[]),
  ('espinaca', 'Espinaca', 'verduras', 'raw', null, 'verduras_libre', 69, 'raw', '{}'::text[]),
  ('acelga', 'Acelga', 'verduras', 'raw', null, 'verduras_libre', 67, 'raw', '{}'::text[]),
  ('brocoli', 'Brócoli', 'verduras', 'raw', null, 'verduras_general', 75, 'raw', '{}'::text[]),
  ('coliflor', 'Coliflor', 'verduras', 'raw', null, 'verduras_general', 101, 'raw', '{}'::text[]),
  ('champinones', 'Champiñones', 'verduras', 'raw', null, 'verduras_libre', 77, 'raw', '{}'::text[]),
  ('pepino', 'Pepino', 'verduras', 'raw', null, 'verduras_libre', 69, 'raw', '{}'::text[]),
  ('apio', 'Apio', 'verduras', 'raw', null, 'verduras_libre', 84, 'raw', '{}'::text[]),
  ('repollo', 'Repollo', 'verduras', 'raw', null, 'verduras_libre', 43, 'raw', '{}'::text[]),
  ('betarraga', 'Betarraga', 'verduras', 'raw', null, 'verduras_general', 52, 'raw', '{}'::text[]),
  ('porotos-verdes', 'Porotos verdes', 'verduras', 'raw', null, 'verduras_general', 72, 'raw', '{}'::text[]),
  ('cilantro', 'Cilantro', 'verduras', 'raw', null, null, null, null, '{}'::text[]),
  ('perejil', 'Perejil', 'verduras', 'raw', null, null, null, null, '{}'::text[]),
  ('albahaca', 'Albahaca', 'verduras', 'raw', null, null, null, null, '{}'::text[]),
  ('palta', 'Palta Hass', 'frutas', 'raw', null, 'alimentos_ricos_lipidos', 97, 'raw', '{}'::text[]),
  ('platano', 'Plátano', 'frutas', 'raw', null, 'frutas', 66, 'raw', '{}'::text[]),
  ('manzana', 'Manzana', 'frutas', 'raw', null, 'frutas', 109, 'raw', '{}'::text[]),
  ('naranja', 'Naranja', 'frutas', 'raw', null, 'frutas', 128, 'raw', '{}'::text[]),
  ('frutillas', 'Frutillas', 'frutas', 'raw', null, 'frutas', 195, 'raw', '{}'::text[]),
  ('arandanos', 'Arándanos', 'frutas', 'raw', null, 'frutas', 104, 'raw', '{}'::text[]),
  ('frambuesas', 'Frambuesas', 'frutas', 'raw', null, 'frutas', 126, 'raw', '{}'::text[]),
  ('kiwi', 'Kiwi', 'frutas', 'raw', 69, 'frutas', 102, 'raw', '{}'::text[]),
  ('pera', 'Pera', 'frutas', 'raw', null, 'frutas', 98, 'raw', '{}'::text[]),
  ('durazno', 'Durazno', 'frutas', 'raw', null, 'frutas', 157, 'raw', '{}'::text[]),
  ('jugo-limon', 'Jugo de limón', 'frutas', 'as_sold', null, null, null, null, '{}'::text[]),
  ('aceite-oliva', 'Aceite de oliva', 'grasas', 'as_sold', null, 'aceites_grasas', 20, 'as_sold', '{}'::text[]),
  ('aceite-vegetal', 'Aceite vegetal (maravilla)', 'grasas', 'as_sold', null, 'aceites_grasas', 20, 'as_sold', '{}'::text[]),
  ('almendras', 'Almendras', 'frutos_secos', 'as_sold', null, 'alimentos_ricos_lipidos', 30, 'as_sold', array['frutos_secos']::text[]),
  ('nueces', 'Nueces', 'frutos_secos', 'as_sold', null, 'alimentos_ricos_lipidos', 23, 'as_sold', array['frutos_secos']::text[]),
  ('mantequilla-mani', 'Mantequilla de maní', 'frutos_secos', 'as_sold', null, 'alimentos_ricos_lipidos', 29, 'as_sold', array['mani']::text[]),
  ('chia', 'Semillas de chía', 'frutos_secos', 'as_sold', null, 'alimentos_ricos_lipidos', 49, 'as_sold', '{}'::text[]),
  ('miel', 'Miel', 'otros', 'as_sold', null, 'azucares', 6, 'as_sold', '{}'::text[]),
  ('azucar', 'Azúcar', 'otros', 'as_sold', null, 'azucares', 5, 'as_sold', '{}'::text[]),
  ('cacao', 'Cacao amargo en polvo', 'otros', 'as_sold', null, null, null, null, '{}'::text[]),
  ('sal', 'Sal', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('pimienta', 'Pimienta negra', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('comino', 'Comino', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('oregano', 'Orégano', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('aji-color', 'Ají de color (pimentón dulce)', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('aji-cayena', 'Ají en polvo (cayena)', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('canela', 'Canela molida', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('salsa-soya', 'Salsa de soya', 'condimentos', 'as_sold', null, null, null, null, array['soya']::text[]),
  ('vinagre', 'Vinagre', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('mostaza', 'Mostaza', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('polvos-hornear', 'Polvos de hornear', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[]),
  ('caldo-verduras', 'Caldo de verduras', 'condimentos', 'as_sold', null, null, null, null, '{}'::text[])
) as v(slug, name, category, state, unit_g, ex_group, ex_grams, ex_state, allergens)
on conflict (catalog_slug) where catalog_slug is not null do update set
  name = excluded.name, category = excluded.category, default_state = excluded.default_state,
  unit_weight_g = excluded.unit_weight_g, exchange_group_code = excluded.exchange_group_code,
  exchange_grams = excluded.exchange_grams, exchange_state = excluded.exchange_state,
  allergen_tags = excluded.allergen_tags, updated_at = now();

insert into public.ingredient_nutrition (ingredient_id, state, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, source, source_ref, confidence)
select i.id, v.state, v.kcal, v.p, v.c, v.f, v.fib, v.na, 'fdc', v.ref, 'calculated'
from (values
  ('pechuga-pollo', 'raw', 120, 22.5, 0, 2.62, 0, 45, 'USDA SR28 NDB 05062: CHICKEN,BROILER OR FRYERS,BRST,SKINLESS,BNLESS,MEAT ONLY,RAW'),
  ('pechuga-pollo', 'cooked', 165, 31.02, 0, 3.57, 0, 74, 'USDA SR28 NDB 05064: CHICKEN,BROILERS OR FRYERS,BREAST,MEAT ONLY,CKD,RSTD'),
  ('trutro-pollo', 'raw', 121, 19.66, 0, 4.12, 0, 95, 'USDA SR28 NDB 05096: CHICKEN,BROILERS OR FRYERS,DK MEAT,THIGH,MEAT ONLY,RAW'),
  ('trutro-pollo', 'cooked', 179, 24.76, 0, 8.15, 0, 106, 'USDA SR28 NDB 05098: CHICKEN,BROILERS OR FRYERS,THIGH,MEAT ONLY,CKD,RSTD'),
  ('carne-molida-5', 'raw', 137, 21.41, 0, 5, 0, 66, 'USDA SR28 NDB 23557: BEEF,GROUND,95% LN MEAT / 5% FAT,RAW'),
  ('carne-molida-5', 'cooked', 193, 29.17, 0, 7.58, 0, 85, 'USDA SR28 NDB 23560: BEEF,GROUND,95% LN MEAT / 5% FAT,CRUMBLES,CKD,PAN-BROWNED'),
  ('carne-molida-10', 'raw', 176, 20, 0, 10, 0, 66, 'USDA SR28 NDB 23562: BEEF,GROUND,90% LN MEAT / 10% FAT,RAW'),
  ('carne-molida-10', 'cooked', 230, 28.45, 0, 12.04, 0, 87, 'USDA SR28 NDB 23565: BEEF,GROUND,90% LN MEAT / 10% FAT,CRUMBLES,CKD,PAN-BROWNED'),
  ('posta-negra', 'raw', 121, 23.59, 0, 2.94, 0, 54, 'USDA SR28 NDB 23357: BEEF,RND,TOP RND RST,BNLESS,LN,0" FAT,ALL GRDS,RAW'),
  ('posta-negra', 'cooked', 162, 30.09, 0, 3.77, 0, 67, 'USDA SR28 NDB 23378: BEEF,RND,TOP RND RST,BNLESS,LN,0" FAT,ALL GRDS,CKD,RSTD'),
  ('carne-guisar', 'raw', 132, 22.11, 0, 4.19, 0, 74, 'USDA SR28 NDB 23603: BEEF,CHUCK,ARM POT RST,LN,1/8" FAT,ALL GRDS,RAW'),
  ('carne-guisar', 'cooked', 214, 34.66, 0, 7.36, 0, 56, 'USDA SR28 NDB 23602: BEEF,CHUCK,ARM POT RST,LN,1/8" FAT,ALL GRDS,CKD,BRSD'),
  ('huevo', 'raw', 143, 12.56, 0.72, 9.51, 0, 142, 'USDA SR28 NDB 01123: EGG,WHL,RAW,FRSH'),
  ('clara-huevo', 'raw', 52, 10.9, 0.73, 0.17, 0, 166, 'USDA SR28 NDB 01124: EGG,WHITE,RAW,FRESH'),
  ('proteina-whey', 'as_sold', 352, 78.13, 6.25, 1.56, 3.1, 156, 'USDA SR28 NDB 14066: BEVERAGES,PROT PDR WHEY BSD'),
  ('leche-descremada', 'as_sold', 34, 3.37, 4.96, 0.08, 0, 42, 'USDA SR28 NDB 01085: MILK,NONFAT,FLUID,W/ ADDED VIT A & VIT D (FAT FREE OR SKIM)'),
  ('leche-semidescremada', 'as_sold', 42, 3.37, 4.99, 0.97, 0, 44, 'USDA SR28 NDB 01082: MILK,LOWFAT,FLUID,1% MILKFAT,W/ ADDED VIT A & VITAMIN D'),
  ('yogur-natural', 'as_sold', 56, 5.73, 7.68, 0.18, 0, 77, 'USDA SR28 NDB 01118: YOGURT,PLN,SKIM MILK,13 GRAMS PROT PER 8 OZ'),
  ('yogur-griego', 'as_sold', 59, 10.19, 3.6, 0.39, 0, 36, 'USDA SR28 NDB 01256: YOGURT,GREEK,PLN,NONFAT'),
  ('queso-cottage', 'as_sold', 72, 12.39, 2.72, 1.02, 0, 406, 'USDA SR28 NDB 01016: CHEESE,COTTAGE,LOWFAT,1% MILKFAT'),
  ('ricotta', 'as_sold', 138, 11.39, 5.14, 7.91, 0, 99, 'USDA SR28 NDB 01037: CHEESE,RICOTTA,PART SKIM MILK'),
  ('queso-gauda', 'as_sold', 356, 24.94, 2.22, 27.44, 0, 819, 'USDA SR28 NDB 01022: CHEESE,GOUDA'),
  ('queso-parmesano', 'as_sold', 420, 28.42, 13.91, 27.84, 0, 1804, 'USDA SR28 NDB 01032: CHEESE,PARMESAN,GRATED'),
  ('queso-mozzarella', 'as_sold', 254, 24.26, 2.77, 15.92, 0, 619, 'USDA SR28 NDB 01028: CHEESE,MOZZARELLA,PART SKIM MILK'),
  ('mantequilla', 'as_sold', 717, 0.85, 0.06, 81.11, 0, 11, 'USDA SR28 NDB 01145: BUTTER,WITHOUT SALT'),
  ('avena', 'raw', 379, 13.15, 67.7, 6.52, 10.1, 6, 'USDA SR28 NDB 08120: CEREALS,OATS,REG & QUICK,NOT FORT,DRY'),
  ('avena', 'cooked', 71, 2.54, 12, 1.52, 1.7, 4, 'USDA SR28 NDB 08121: CEREALS,OATS,REG & QUICK,UNENR,CKD W/ H2O,WO/ SALT'),
  ('arroz', 'raw', 365, 7.13, 79.95, 0.66, 1.3, 5, 'USDA SR28 NDB 20444: RICE,WHITE,LONG-GRAIN,REG,RAW,UNENR'),
  ('arroz', 'cooked', 130, 2.69, 28.17, 0.28, 0.4, 1, 'USDA SR28 NDB 20445: RICE,WHITE,LONG-GRAIN,REG,UNENR,CKD WO/ SALT'),
  ('arroz-integral', 'raw', 367, 7.54, 76.25, 3.2, 3.6, 5, 'USDA SR28 NDB 20036: RICE,BROWN,LONG-GRAIN,RAW'),
  ('arroz-integral', 'cooked', 123, 2.74, 25.58, 0.97, 1.6, 4, 'USDA SR28 NDB 20037: RICE,BROWN,LONG-GRAIN,CKD'),
  ('fideos', 'raw', 371, 13.04, 74.67, 1.51, 3.2, 6, 'USDA SR28 NDB 20120: PASTA,DRY,ENR'),
  ('fideos', 'cooked', 158, 5.8, 30.86, 0.93, 1.8, 1, 'USDA SR28 NDB 20121: PASTA,CKD,ENR,WO/ ADDED SALT'),
  ('fideos-integrales', 'raw', 352, 13.87, 73.37, 2.93, 9.2, 6, 'USDA SR28 NDB 20124: PASTA,WHOLE-WHEAT,DRY'),
  ('fideos-integrales', 'cooked', 149, 5.99, 30.07, 1.71, 3.9, 4, 'USDA SR28 NDB 20125: PASTA,WHOLE-WHEAT,CKD'),
  ('cuscus', 'raw', 376, 12.76, 77.43, 0.64, 5, 10, 'USDA SR28 NDB 20028: COUSCOUS,DRY'),
  ('cuscus', 'cooked', 112, 3.79, 23.22, 0.16, 1.4, 5, 'USDA SR28 NDB 20029: COUSCOUS,COOKED'),
  ('harina', 'as_sold', 364, 10.33, 76.31, 0.98, 2.7, 2, 'USDA SR28 NDB 20081: WHEAT FLR,WHITE,ALL-PURPOSE,ENR,BLEACHED'),
  ('pan-integral', 'as_sold', 252, 12.45, 42.71, 3.5, 6, 455, 'USDA SR28 NDB 18075: BREAD,WHOLE-WHEAT,COMM. PREPARED'),
  ('pan-frances', 'as_sold', 272, 10.75, 51.88, 2.42, 2.2, 602, 'USDA SR28 NDB 18029: Bread, french'),
  ('pan-hamburguesa', 'as_sold', 279, 9.77, 50.12, 3.91, 1.8, 494, 'USDA SR28 NDB 18350: ROLLS,HAMBURGER OR HOTDOG,PLN'),
  ('tortilla-harina', 'as_sold', 306, 8.2, 49.38, 7.99, 3.5, 736, 'USDA SR28 NDB 18364: TORTILLAS,RTB OR -FRY,FLR,REFR'),
  ('papa', 'raw', 77, 2.05, 17.49, 0.09, 2.1, 6, 'USDA SR28 NDB 11352: POTATOES,FLESH & SKN,RAW'),
  ('papa', 'cooked', 93, 2.5, 21.15, 0.13, 2.2, 10, 'USDA SR28 NDB 11674: POTATOES,BKD,FLESH & SKN,WO/ SALT'),
  ('camote', 'raw', 86, 1.57, 20.12, 0.05, 3, 55, 'USDA SR28 NDB 11507: SWEET POTATO,RAW,UNPREP'),
  ('camote', 'cooked', 90, 2.01, 20.71, 0.15, 3.3, 36, 'USDA SR28 NDB 11508: SWEET POTATO,CKD,BKD IN SKN,FLESH,WO/ SALT'),
  ('choclo', 'raw', 86, 3.27, 18.7, 1.35, 2, 15, 'USDA SR28 NDB 11167: CORN,SWT,YEL,RAW'),
  ('arvejas', 'raw', 77, 5.22, 13.62, 0.4, 4.5, 108, 'USDA SR28 NDB 11312: PEAS,GRN,FRZ,UNPREP'),
  ('lentejas', 'raw', 352, 24.63, 63.35, 1.06, 10.7, 6, 'USDA SR28 NDB 16069: LENTILS,RAW'),
  ('lentejas', 'cooked', 116, 9.02, 20.13, 0.38, 7.9, 2, 'USDA SR28 NDB 16070: LENTILS,MATURE SEEDS,CKD,BLD,WO/SALT'),
  ('garbanzos', 'raw', 378, 20.47, 62.95, 6.04, 12.2, 24, 'USDA SR28 NDB 16056: CHICKPEAS (GARBANZO BNS,BENGAL GM),MATURE SEEDS,RAW'),
  ('garbanzos', 'cooked', 164, 8.86, 27.42, 2.59, 7.6, 7, 'USDA SR28 NDB 16057: CHICKPEAS ,MATURE SEEDS,CKD,BLD,WO/SALT'),
  ('porotos-negros', 'raw', 341, 21.6, 62.36, 1.42, 15.5, 5, 'USDA SR28 NDB 16014: BEANS,BLACK,MATURE SEEDS,RAW'),
  ('porotos-negros', 'cooked', 132, 8.86, 23.71, 0.54, 8.7, 1, 'USDA SR28 NDB 16015: BEANS,BLACK,MATURE SEEDS,CKD,BLD,WO/SALT'),
  ('porotos', 'raw', 335, 23.03, 60.05, 1.23, 24.7, 6, 'USDA SR28 NDB 16019: BEANS,CRANBERRY (ROMAN),MATURE SEEDS,RAW'),
  ('porotos', 'cooked', 136, 9.34, 24.46, 0.46, 8.6, 1, 'USDA SR28 NDB 16020: BEANS,CRANBERRY (ROMAN),MATURE SEEDS,CKD,BLD,WO/SALT'),
  ('cebolla', 'raw', 40, 1.1, 9.34, 0.1, 1.7, 4, 'USDA SR28 NDB 11282: ONIONS,RAW'),
  ('ajo', 'raw', 149, 6.36, 33.06, 0.5, 2.1, 17, 'USDA SR28 NDB 11215: GARLIC,RAW'),
  ('tomate', 'raw', 18, 0.88, 3.89, 0.2, 1.2, 5, 'USDA SR28 NDB 11529: TOMATOES,RED,RIPE,RAW,YEAR RND AVERAGE'),
  ('tomate-conserva', 'as_sold', 16, 0.79, 3.47, 0.25, 1.9, 115, 'USDA SR28 NDB 11531: TOMATOES,RED,RIPE,CND,PACKED IN TOMATO JUC'),
  ('salsa-tomate', 'as_sold', 24, 1.2, 5.31, 0.3, 1.5, 474, 'USDA SR28 NDB 11549: TOMATO PRODUCTS,CND,SAU'),
  ('zanahoria', 'raw', 41, 0.93, 9.58, 0.24, 2.8, 69, 'USDA SR28 NDB 11124: CARROTS,RAW'),
  ('zapallo-italiano', 'raw', 17, 1.21, 3.11, 0.32, 1, 8, 'USDA SR28 NDB 11477: SQUASH,SMMR,ZUCCHINI,INCL SKN,RAW'),
  ('zapallo-camote', 'raw', 45, 1, 11.69, 0.1, 2, 4, 'USDA SR28 NDB 11485: SQUASH,WNTR,BUTTERNUT,RAW'),
  ('pimenton-rojo', 'raw', 31, 0.99, 6.03, 0.3, 2.1, 4, 'USDA SR28 NDB 11821: PEPPERS,SWT,RED,RAW'),
  ('pimenton-verde', 'raw', 20, 0.86, 4.64, 0.17, 1.7, 3, 'USDA SR28 NDB 11333: PEPPERS,SWT,GRN,RAW'),
  ('lechuga', 'raw', 17, 1.23, 3.29, 0.3, 2.1, 8, 'USDA SR28 NDB 11251: LETTUCE,COS OR ROMAINE,RAW'),
  ('espinaca', 'raw', 23, 2.86, 3.63, 0.39, 2.2, 79, 'USDA SR28 NDB 11457: SPINACH,RAW'),
  ('acelga', 'raw', 19, 1.8, 3.74, 0.2, 1.6, 213, 'USDA SR28 NDB 11147: CHARD,SWISS,RAW'),
  ('brocoli', 'raw', 34, 2.82, 6.64, 0.37, 2.6, 33, 'USDA SR28 NDB 11090: BROCCOLI,RAW'),
  ('coliflor', 'raw', 25, 1.92, 4.97, 0.28, 2, 30, 'USDA SR28 NDB 11135: CAULIFLOWER,RAW'),
  ('champinones', 'raw', 22, 3.09, 3.26, 0.34, 1, 5, 'USDA SR28 NDB 11260: MUSHROOMS,WHITE,RAW'),
  ('pepino', 'raw', 15, 0.65, 3.63, 0.11, 0.5, 2, 'USDA SR28 NDB 11205: CUCUMBER,WITH PEEL,RAW'),
  ('apio', 'raw', 16, 0.69, 2.97, 0.17, 1.6, 80, 'USDA SR28 NDB 11143: CELERY,RAW'),
  ('repollo', 'raw', 25, 1.28, 5.8, 0.1, 2.5, 18, 'USDA SR28 NDB 11109: CABBAGE,RAW'),
  ('betarraga', 'raw', 43, 1.61, 9.56, 0.17, 2.8, 78, 'USDA SR28 NDB 11080: BEETS,RAW'),
  ('porotos-verdes', 'raw', 31, 1.83, 6.97, 0.22, 2.7, 6, 'USDA SR28 NDB 11052: BEANS,SNAP,GREEN,RAW'),
  ('cilantro', 'raw', 23, 2.13, 3.67, 0.52, 2.8, 46, 'USDA SR28 NDB 11165: CORIANDER (CILANTRO) LEAVES,RAW'),
  ('perejil', 'raw', 36, 2.97, 6.33, 0.79, 3.3, 56, 'USDA SR28 NDB 11297: PARSLEY,FRSH'),
  ('albahaca', 'raw', 23, 3.15, 2.65, 0.64, 1.6, 4, 'USDA SR28 NDB 02044: BASIL,FRESH'),
  ('palta', 'raw', 167, 1.96, 8.64, 15.41, 6.8, 8, 'USDA SR28 NDB 09038: AVOCADOS,RAW,CALIFORNIA'),
  ('platano', 'raw', 89, 1.09, 22.84, 0.33, 2.6, 1, 'USDA SR28 NDB 09040: BANANAS,RAW'),
  ('manzana', 'raw', 52, 0.26, 13.81, 0.17, 2.4, 1, 'USDA SR28 NDB 09003: APPLES,RAW,WITH SKIN'),
  ('naranja', 'raw', 47, 0.94, 11.75, 0.12, 2.4, 0, 'USDA SR28 NDB 09200: ORANGES,RAW,ALL COMM VAR'),
  ('frutillas', 'raw', 32, 0.67, 7.68, 0.3, 2, 1, 'USDA SR28 NDB 09316: STRAWBERRIES,RAW'),
  ('arandanos', 'raw', 57, 0.74, 14.49, 0.33, 2.4, 1, 'USDA SR28 NDB 09050: BLUEBERRIES,RAW'),
  ('frambuesas', 'raw', 52, 1.2, 11.94, 0.65, 6.5, 1, 'USDA SR28 NDB 09302: RASPBERRIES,RAW'),
  ('kiwi', 'raw', 61, 1.14, 14.66, 0.52, 3, 3, 'USDA SR28 NDB 09148: KIWIFRUIT,GRN,RAW'),
  ('pera', 'raw', 57, 0.36, 15.23, 0.14, 3.1, 1, 'USDA SR28 NDB 09252: PEARS,RAW'),
  ('durazno', 'raw', 39, 0.91, 9.54, 0.25, 1.5, 0, 'USDA SR28 NDB 09236: PEACHES,YEL,RAW'),
  ('jugo-limon', 'as_sold', 22, 0.35, 6.9, 0.24, 0.3, 1, 'USDA SR28 NDB 09152: LEMON JUICE,RAW'),
  ('aceite-oliva', 'as_sold', 884, 0, 0, 100, 0, 2, 'USDA SR28 NDB 04053: OIL,OLIVE,SALAD OR COOKING'),
  ('aceite-vegetal', 'as_sold', 884, 0, 0, 100, 0, 0, 'USDA SR28 NDB 04506: OIL,SUNFLOWER,LINOLEIC,(APPROX. 65%)'),
  ('almendras', 'as_sold', 579, 21.15, 21.55, 49.93, 12.5, 1, 'USDA SR28 NDB 12061: ALMONDS'),
  ('nueces', 'as_sold', 654, 15.23, 13.71, 65.21, 6.7, 2, 'USDA SR28 NDB 12155: WALNUTS,ENGLISH'),
  ('mantequilla-mani', 'as_sold', 598, 22.21, 22.31, 51.36, 5, 17, 'USDA SR28 NDB 16398: PEANUT BUTTER,SMOOTH STYLE,WO/SALT'),
  ('chia', 'as_sold', 486, 16.54, 42.12, 30.74, 34.4, 16, 'USDA SR28 NDB 12006: CHIA SEEDS,DRIED'),
  ('miel', 'as_sold', 304, 0.3, 82.4, 0, 0.2, 4, 'USDA SR28 NDB 19296: HONEY'),
  ('azucar', 'as_sold', 387, 0, 99.98, 0, 0, 1, 'USDA SR28 NDB 19335: SUGARS,GRANULATED'),
  ('cacao', 'as_sold', 228, 19.6, 57.9, 13.7, 37, 21, 'USDA SR28 NDB 19165: COCOA,DRY PDR,UNSWTND'),
  ('sal', 'as_sold', 0, 0, 0, 0, 0, 38758, 'USDA SR28 NDB 02047: SALT,TABLE'),
  ('pimienta', 'as_sold', 251, 10.39, 63.95, 3.26, 25.3, 20, 'USDA SR28 NDB 02030: PEPPER,BLACK'),
  ('comino', 'as_sold', 375, 17.81, 44.24, 22.27, 10.5, 168, 'USDA SR28 NDB 02014: CUMIN SEED'),
  ('oregano', 'as_sold', 265, 9, 68.92, 4.28, 42.5, 25, 'USDA SR28 NDB 02027: SPICES,OREGANO,DRIED'),
  ('aji-color', 'as_sold', 282, 14.14, 53.99, 12.89, 34.9, 68, 'USDA SR28 NDB 02028: PAPRIKA'),
  ('aji-cayena', 'as_sold', 318, 12.01, 56.63, 17.27, 27.2, 30, 'USDA SR28 NDB 02031: PEPPER,RED OR CAYENNE'),
  ('canela', 'as_sold', 247, 3.99, 80.59, 1.24, 53.1, 10, 'USDA SR28 NDB 02010: CINNAMON,GROUND'),
  ('salsa-soya', 'as_sold', 60, 10.51, 5.57, 0.1, 0.8, 5586, 'USDA SR28 NDB 16124: SOY SAU MADE FROM SOY (TAMARI)'),
  ('vinagre', 'as_sold', 18, 0, 0.04, 0, 0, 2, 'USDA SR28 NDB 02053: VINEGAR,DISTILLED'),
  ('mostaza', 'as_sold', 60, 3.74, 5.83, 3.34, 4, 1104, 'USDA SR28 NDB 02046: MUSTARD,PREPARED,YELLOW'),
  ('polvos-hornear', 'as_sold', 53, 0, 27.7, 0, 0.2, 10600, 'USDA SR28 NDB 18369: LEAVENING AGENTS,BAKING PDR,DOUBLE-ACTING,NA AL SULFATE'),
  ('caldo-verduras', 'as_sold', 6, 0.23, 1.02, 0.07, 0, 303, 'USDA SR28 NDB 06615: SOUP,SWANSON,VEG BROTH')
) as v(slug, state, kcal, p, c, f, fib, na, ref)
join public.ingredients i on i.catalog_slug = v.slug
on conflict (ingredient_id, state) do update set
  kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g,
  fiber_g = excluded.fiber_g, sodium_mg = excluded.sodium_mg, source = excluded.source,
  source_ref = excluded.source_ref, confidence = excluded.confidence;

insert into public.ingredient_yields (ingredient_id, method, yield_factor)
select i.id, 'default', v.y
from (values
  ('pechuga-pollo', 0.73),
  ('trutro-pollo', 0.79),
  ('carne-molida-5', 0.73),
  ('carne-molida-10', 0.7),
  ('posta-negra', 0.78),
  ('carne-guisar', 0.64),
  ('arroz', 2.8),
  ('arroz-integral', 2.97),
  ('fideos', 2.38),
  ('fideos-integrales', 2.4),
  ('cuscus', 3.33),
  ('papa', 0.83),
  ('camote', 0.94),
  ('lentejas', 3.02),
  ('garbanzos', 2.32),
  ('porotos-negros', 2.6),
  ('porotos', 2.48)
) as v(slug, y)
join public.ingredients i on i.catalog_slug = v.slug
on conflict (ingredient_id, method) do update set yield_factor = excluded.yield_factor;

-- Rendimientos que el catálogo ya no define
delete from public.ingredient_yields y
using public.ingredients i
where y.ingredient_id = i.id and i.catalog_slug is not null and y.method = 'default'
  and i.catalog_slug <> all (array['pechuga-pollo', 'trutro-pollo', 'carne-molida-5', 'carne-molida-10', 'posta-negra', 'carne-guisar', 'arroz', 'arroz-integral', 'fideos', 'fideos-integrales', 'cuscus', 'papa', 'camote', 'lentejas', 'garbanzos', 'porotos-negros', 'porotos']::text[]);

insert into public.recipe_catalog (slug, name, category, tags, prep_minutes, servings_nominal, is_homogeneous, expected_cooked_yield_g, instructions, lines)
select v.slug, v.name, v.category, v.tags, v.prep::int, v.servings::numeric, v.homog, v.yield_g::numeric, v.instructions, v.lines
from (values
  ('avena-proteica-platano', 'Avena cocida con proteína y plátano', 'desayunos', array['alta en proteínas', 'rápida', 'vegetariana']::text[], 10, 1, false, null, 'Cocina la avena en la leche a fuego bajo 4 a 5 minutos, revolviendo, hasta que espese. Retira del fuego y deja entibiar un minuto antes de incorporar la proteína (así no se apelotona). Sirve con el plátano en rodajas y la canela.', '[{"ingredient":"avena","grams":40,"state":"raw","role":"adjustable","min_g":20,"max_g":80},{"ingredient":"leche-descremada","grams":200,"state":"as_sold","role":"adjustable","min_g":100,"max_g":350},{"ingredient":"proteina-whey","grams":25,"state":"as_sold","role":"adjustable","min_g":0,"max_g":40},{"ingredient":"platano","grams":60,"state":"raw","role":"side","min_g":0,"max_g":120},{"ingredient":"canela","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('huevos-revueltos-tostadas', 'Huevos revueltos con tostadas integrales', 'desayunos', array['rápida', 'sin lactosa', 'vegetariana']::text[], 10, 1, false, null, 'Bate los huevos con la sal. Calienta el aceite en un sartén antiadherente a fuego medio-bajo, agrega los huevos y revuelve con espátula sin parar hasta que cuajen cremosos. Sirve con las tostadas y el tomate en rodajas.', '[{"ingredient":"huevo","grams":100,"state":"raw","role":"adjustable","min_g":50,"max_g":200,"integer_unit_g":50},{"ingredient":"aceite-oliva","grams":3,"state":"as_sold","role":"adjustable","min_g":2,"max_g":6},{"ingredient":"pan-integral","grams":64,"state":"as_sold","role":"side","min_g":0,"max_g":96,"integer_unit_g":32},{"ingredient":"tomate","grams":80,"state":"raw","role":"side","min_g":0,"max_g":160},{"ingredient":"sal","grams":0.5,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('yogur-griego-frutos-rojos', 'Yogur griego con frutos rojos, avena y almendras', 'desayunos', array['alta en proteínas', 'rápida', 'vegetariana']::text[], 5, 1, false, null, 'Sirve el yogur en un bol, agrega la fruta picada, la avena cruda y las almendras picadas. Termina con un hilo de miel.', '[{"ingredient":"yogur-griego","grams":170,"state":"as_sold","role":"adjustable","min_g":100,"max_g":300},{"ingredient":"frutillas","grams":60,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"arandanos","grams":40,"state":"raw","role":"side","min_g":0,"max_g":100},{"ingredient":"avena","grams":20,"state":"raw","role":"side","min_g":0,"max_g":50},{"ingredient":"almendras","grams":10,"state":"as_sold","role":"adjustable","min_g":0,"max_g":25},{"ingredient":"miel","grams":5,"state":"as_sold","role":"adjustable","min_g":0,"max_g":10}]'::jsonb),
  ('tostadas-palta-huevo', 'Tostadas con palta y huevo', 'desayunos', array['rápida', 'sin lactosa', 'vegetariana']::text[], 10, 1, false, null, 'Tuesta el pan. Muele la palta con la sal y la pimienta y úntala. Cocina el huevo a la plancha o pochado (3 minutos en agua apenas hirviendo) y ponlo encima. Acompaña con tomate.', '[{"ingredient":"pan-integral","grams":64,"state":"as_sold","role":"side","min_g":32,"max_g":96,"integer_unit_g":32},{"ingredient":"palta","grams":50,"state":"raw","role":"adjustable","min_g":25,"max_g":90},{"ingredient":"huevo","grams":50,"state":"raw","role":"adjustable","min_g":50,"max_g":150,"integer_unit_g":50},{"ingredient":"tomate","grams":50,"state":"raw","role":"side","min_g":0,"max_g":120},{"ingredient":"sal","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"pimienta","grams":0.2,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('panqueques-avena-platano', 'Panqueques de avena y plátano', 'desayunos', array['batch cooking', 'congelable', 'rápida', 'sin lactosa', 'vegetariana']::text[], 20, 2, true, 400, 'Procesa la avena hasta que quede como harina. Agrega el huevo, las claras, el plátano, los polvos de hornear y la canela y licúa hasta tener una masa lisa. Deja reposar 5 minutos. Pinta un sartén con el aceite y cocina porciones de masa a fuego medio, 1 a 2 minutos por lado. Pesa el total de panqueques para que las porciones queden exactas. Sirve con frutillas y miel.', '[{"ingredient":"avena","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"huevo","grams":50,"state":"raw","role":"adjustable"},{"ingredient":"clara-huevo","grams":66,"state":"raw","role":"adjustable"},{"ingredient":"platano","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"polvos-hornear","grams":2,"state":"as_sold","role":"fixed"},{"ingredient":"canela","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-vegetal","grams":2,"state":"as_sold","role":"adjustable"},{"ingredient":"frutillas","grams":60,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"miel","grams":6,"state":"as_sold","role":"side","min_g":0,"max_g":12}]'::jsonb),
  ('batido-proteina-frutilla', 'Batido de proteína con frutilla y avena', 'desayunos', array['alta en proteínas', 'rápida', 'vegetariana']::text[], 5, 1, false, null, 'Licúa todo con un par de cubos de hielo hasta que quede homogéneo. Si usas frutillas congeladas, no necesitas hielo.', '[{"ingredient":"leche-descremada","grams":250,"state":"as_sold","role":"adjustable","min_g":150,"max_g":400},{"ingredient":"proteina-whey","grams":25,"state":"as_sold","role":"adjustable","min_g":0,"max_g":40},{"ingredient":"frutillas","grams":120,"state":"raw","role":"adjustable","min_g":60,"max_g":200},{"ingredient":"avena","grams":20,"state":"raw","role":"adjustable","min_g":0,"max_g":50}]'::jsonb),
  ('tostadas-ricotta-tomate', 'Tostadas con ricotta, tomate y orégano', 'desayunos', array['rápida', 'vegetariana']::text[], 5, 1, false, null, 'Tuesta el pan, unta la ricotta, cubre con tomate en rodajas y termina con aceite de oliva, orégano y sal.', '[{"ingredient":"pan-integral","grams":64,"state":"as_sold","role":"side","min_g":32,"max_g":96,"integer_unit_g":32},{"ingredient":"ricotta","grams":60,"state":"as_sold","role":"adjustable","min_g":30,"max_g":120},{"ingredient":"tomate","grams":80,"state":"raw","role":"adjustable","min_g":40,"max_g":160},{"ingredient":"aceite-oliva","grams":3,"state":"as_sold","role":"adjustable","min_g":0,"max_g":6},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":0.3,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('tallarines-bolonesa', 'Tallarines con salsa boloñesa', 'almuerzos', array['batch cooking', 'congelable']::text[], 50, 4, true, null, 'Pica fino cebolla, zanahoria y ajo y sofríelos en el aceite a fuego bajo 8 minutos (soffritto). Sube el fuego, agrega la carne y dórala bien, rompiéndola. Incorpora la salsa de tomate, el orégano y la sal y cocina tapado a fuego mínimo 25 a 30 minutos. Pesa la olla con la salsa terminada (descontando la tara). Cocina los fideos al dente por separado: cada uno recibe sus gramos de salsa y de pasta.', '[{"ingredient":"carne-molida-5","grams":125,"state":"raw","role":"adjustable"},{"ingredient":"salsa-tomate","grams":120,"state":"as_sold","role":"adjustable"},{"ingredient":"cebolla","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"zanahoria","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":4,"state":"raw","role":"fixed"},{"ingredient":"aceite-oliva","grams":5,"state":"as_sold","role":"adjustable"},{"ingredient":"oregano","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"fideos","grams":80,"state":"raw","role":"side","min_g":0,"max_g":160},{"ingredient":"queso-parmesano","grams":5,"state":"as_sold","role":"side","min_g":0,"max_g":15}]'::jsonb),
  ('lentejas-con-arroz', 'Lentejas guisadas con arroz', 'almuerzos', array['batch cooking', 'congelable', 'económica', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 60, 4, true, null, 'Remoja las lentejas la noche anterior (opcional) y enjuágalas. Sofríe cebolla, pimentón, zanahoria y ajo en el aceite con el comino y el ají de color. Agrega las lentejas, el zapallo en cubos y agua que las cubra por 3 cm; cocina 35 a 40 minutos hasta que estén blandas, agregando agua si hace falta. Sala al final. Pesa la olla terminada. Cocina el arroz aparte.', '[{"ingredient":"lentejas","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"zapallo-camote","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"zanahoria","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"pimenton-rojo","grams":20,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"comino","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"aji-color","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-oliva","grams":4,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"arroz","grams":30,"state":"raw","role":"side","min_g":0,"max_g":80}]'::jsonb),
  ('porotos-con-riendas', 'Porotos con riendas', 'almuerzos', array['batch cooking', 'congelable', 'económica', 'sin lactosa', 'vegetariana']::text[], 90, 4, true, null, 'Remoja los porotos 12 horas y cuécelos en agua nueva 60 a 70 minutos. Aparte, sofríe cebolla y ajo con el ají de color en el aceite y agrégalo a la olla junto con el zapallo en cubos. Cuando el zapallo esté blando, aplástalo un poco para espesar, agrega los tallarines quebrados y cocina 10 minutos más. Sala al final y pesa la olla.', '[{"ingredient":"porotos","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"zapallo-camote","grams":80,"state":"raw","role":"adjustable"},{"ingredient":"fideos","grams":20,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"aji-color","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-oliva","grams":4,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('garbanzos-espinaca', 'Garbanzos guisados con espinaca', 'almuerzos', array['batch cooking', 'congelable', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 45, 4, true, null, 'Cuece los garbanzos remojados hasta que estén tiernos (o usa garbanzos ya cocidos). Sofríe cebolla y ajo con las especias, agrega el tomate y cocina 10 minutos. Incorpora los garbanzos con un poco de su caldo y cocina 10 minutos más. Al final agrega la espinaca y deja que se marchite. Pesa la olla. El arroz integral va aparte.', '[{"ingredient":"garbanzos","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"tomate-conserva","grams":100,"state":"as_sold","role":"adjustable"},{"ingredient":"espinaca","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":4,"state":"raw","role":"fixed"},{"ingredient":"comino","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"aji-color","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-oliva","grams":5,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"arroz-integral","grams":30,"state":"raw","role":"side","min_g":0,"max_g":80}]'::jsonb),
  ('charquican', 'Charquicán', 'almuerzos', array['batch cooking', 'sin gluten', 'sin lactosa']::text[], 50, 4, true, null, 'Sofríe cebolla y ajo en el aceite, agrega la carne y dórala con el comino y el orégano. Suma la papa y el zapallo en cubos y una taza de agua; cocina tapado 20 minutos. Agrega choclo y arvejas, cocina 5 minutos más y muele grueso con un tenedor. Sala y pesa la olla. El huevo (frito o a la plancha) es opcional y va por persona.', '[{"ingredient":"carne-molida-5","grams":90,"state":"raw","role":"adjustable"},{"ingredient":"papa","grams":150,"state":"raw","role":"adjustable"},{"ingredient":"zapallo-camote","grams":100,"state":"raw","role":"adjustable"},{"ingredient":"choclo","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"arvejas","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"comino","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-vegetal","grams":4,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"huevo","grams":50,"state":"raw","role":"side","min_g":0,"max_g":100,"integer_unit_g":50}]'::jsonb),
  ('cazuela-pollo', 'Cazuela de pollo', 'almuerzos', array['alta en proteínas', 'batch cooking', 'sin gluten', 'sin lactosa']::text[], 60, 4, true, 2800, 'Sella el pollo en una olla grande, agrega cebolla, ajo y zanahoria y cubre con 1,2 litros de agua. Cocina 20 minutos. Suma papa, zapallo y arroz y cocina 15 minutos; al final agrega choclo y porotos verdes por 5 minutos. Sala, perfuma con orégano y pesa la olla con el caldo: la cazuela se reparte por peso, con caldo incluido.', '[{"ingredient":"trutro-pollo","grams":120,"state":"raw","role":"adjustable"},{"ingredient":"papa","grams":120,"state":"raw","role":"adjustable"},{"ingredient":"zapallo-camote","grams":80,"state":"raw","role":"adjustable"},{"ingredient":"choclo","grams":50,"state":"raw","role":"adjustable"},{"ingredient":"porotos-verdes","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"zanahoria","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"arroz","grams":10,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('pollo-horno-papas-ensalada', 'Pollo al horno con papas y ensalada', 'almuerzos', array['alta en proteínas', 'sin gluten', 'sin lactosa']::text[], 50, 1, false, null, 'Adoba el pollo con limón, ají de color, orégano y sal. Corta las papas en gajos. Hornea todo a 200 °C: las papas 40 minutos y el pollo los últimos 20 a 25 (hasta 74 °C en el centro). Arma la ensalada y alíñala con el aceite y el resto del limón.', '[{"ingredient":"pechuga-pollo","grams":150,"state":"raw","role":"adjustable","min_g":100,"max_g":280},{"ingredient":"papa","grams":180,"state":"raw","role":"side","min_g":0,"max_g":350},{"ingredient":"lechuga","grams":60,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"tomate","grams":80,"state":"raw","role":"side","min_g":0,"max_g":160},{"ingredient":"aceite-oliva","grams":8,"state":"as_sold","role":"ratio","ratio_group":"aliño"},{"ingredient":"jugo-limon","grams":8,"state":"as_sold","role":"ratio","ratio_group":"aliño"},{"ingredient":"aji-color","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('arroz-salteado-pollo', 'Salteado de pollo y verduras con arroz', 'almuerzos', array['alta en proteínas', 'sin gluten', 'sin lactosa']::text[], 25, 2, true, null, 'Cocina el arroz. Corta el pollo en tiras y las verduras en trozos parejos. En un wok o sartén muy caliente con el aceite, saltea el pollo hasta dorar y retíralo. Saltea las verduras 3 a 4 minutos (deben quedar crujientes), devuelve el pollo, agrega ajo y salsa de soya y mezcla 1 minuto. Pesa el salteado y reparte; el arroz va aparte.', '[{"ingredient":"pechuga-pollo","grams":130,"state":"raw","role":"adjustable"},{"ingredient":"brocoli","grams":80,"state":"raw","role":"adjustable"},{"ingredient":"zanahoria","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"pimenton-rojo","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"salsa-soya","grams":10,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-vegetal","grams":6,"state":"as_sold","role":"adjustable"},{"ingredient":"arroz","grams":60,"state":"raw","role":"side","min_g":0,"max_g":120}]'::jsonb),
  ('posta-pure-ensalada', 'Posta a la plancha con puré y ensalada', 'almuerzos', array['alta en proteínas', 'sin gluten']::text[], 35, 1, false, null, 'Cuece las papas peladas en agua con sal hasta que estén blandas, muélelas y agrega la leche caliente y la mantequilla. Seca bien la carne, sálala y márcala en una plancha muy caliente 3 a 4 minutos por lado; déjala reposar 5 minutos antes de cortar. Sirve con la ensalada aliñada.', '[{"ingredient":"posta-negra","grams":150,"state":"raw","role":"adjustable","min_g":100,"max_g":260},{"ingredient":"papa","grams":200,"state":"raw","role":"side","min_g":0,"max_g":350},{"ingredient":"leche-descremada","grams":40,"state":"as_sold","role":"side","min_g":0,"max_g":80},{"ingredient":"mantequilla","grams":4,"state":"as_sold","role":"side","min_g":0,"max_g":8},{"ingredient":"lechuga","grams":50,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"tomate","grams":60,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"aceite-oliva","grams":5,"state":"as_sold","role":"ratio","ratio_group":"aliño"},{"ingredient":"vinagre","grams":4,"state":"as_sold","role":"ratio","ratio_group":"aliño"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('pasta-pollo-espinaca-ricotta', 'Pasta con pollo, espinaca y ricotta', 'almuerzos', '{}'::text[], 25, 1, false, null, 'Cocina la pasta al dente y guarda medio vaso del agua de cocción. Dora el pollo en cubos en el aceite con el ajo, agrega la espinaca y deja que se marchite. Incorpora la pasta, la ricotta y un chorrito del agua de cocción y mezcla hasta que quede cremoso. Termina con el parmesano.', '[{"ingredient":"fideos","grams":80,"state":"raw","role":"side","min_g":0,"max_g":160},{"ingredient":"pechuga-pollo","grams":110,"state":"raw","role":"adjustable","min_g":60,"max_g":220},{"ingredient":"espinaca","grams":60,"state":"raw","role":"adjustable","min_g":30,"max_g":150},{"ingredient":"ricotta","grams":40,"state":"as_sold","role":"adjustable","min_g":0,"max_g":100},{"ingredient":"queso-parmesano","grams":6,"state":"as_sold","role":"adjustable","min_g":0,"max_g":15},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"aceite-oliva","grams":6,"state":"as_sold","role":"adjustable","min_g":3,"max_g":10},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('carne-mechada-arroz', 'Carne mechada con arroz', 'almuerzos', array['alta en proteínas', 'batch cooking', 'congelable', 'sin gluten', 'sin lactosa']::text[], 150, 6, true, null, 'Dora la carne entera en el aceite en una olla gruesa y retírala. En la misma olla sofríe cebolla, zanahoria, pimentón y ajo; vuelve la carne, agrega tomate, especias y agua hasta cubrir la mitad. Cocina tapado a fuego mínimo 2 horas, dando vuelta la carne, hasta que se deshilache. Desmenúzala dentro de su jugo y pesa la olla. El arroz va aparte.', '[{"ingredient":"carne-guisar","grams":130,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":50,"state":"raw","role":"adjustable"},{"ingredient":"zanahoria","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"pimenton-rojo","grams":30,"state":"raw","role":"adjustable"},{"ingredient":"tomate-conserva","grams":60,"state":"as_sold","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"comino","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"aceite-vegetal","grams":4,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"arroz","grams":50,"state":"raw","role":"side","min_g":0,"max_g":100}]'::jsonb),
  ('hamburguesas-caseras', 'Hamburguesas caseras con papas al horno y ensalada', 'cenas', array['congelable']::text[], 45, 1, false, null, 'Forma hamburguesas de 120 g con la carne y la sal, sin amasar de más. Hornea las papas en gajos con el aceite a 200 °C por 35 minutos. Cocina las hamburguesas en plancha caliente 3 a 4 minutos por lado; si lleva queso, ponlo el último minuto. Cada uno arma su plato: con o sin pan y queso.', '[{"ingredient":"carne-molida-5","grams":120,"state":"raw","role":"adjustable","min_g":120,"max_g":360,"integer_unit_g":120},{"ingredient":"papa","grams":150,"state":"raw","role":"side","min_g":0,"max_g":300},{"ingredient":"lechuga","grams":40,"state":"raw","role":"side","min_g":0,"max_g":120},{"ingredient":"tomate","grams":50,"state":"raw","role":"side","min_g":0,"max_g":120},{"ingredient":"pan-hamburguesa","grams":44,"state":"as_sold","role":"side","min_g":0,"max_g":44,"integer_unit_g":44},{"ingredient":"queso-gauda","grams":15,"state":"as_sold","role":"side","min_g":0,"max_g":30},{"ingredient":"aceite-oliva","grams":4,"state":"as_sold","role":"adjustable","min_g":2,"max_g":8},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('omelette-espinaca-champinones', 'Omelette de espinaca, champiñones y queso', 'cenas', array['alta en proteínas', 'rápida', 'vegetariana']::text[], 15, 1, false, null, 'Saltea los champiñones en la mitad del aceite hasta que suelten su agua y doren; agrega la espinaca un minuto y reserva. Bate huevos, claras y sal, cuájalos en el sartén con el resto del aceite a fuego medio-bajo, rellena con las verduras y el queso y dobla.', '[{"ingredient":"huevo","grams":100,"state":"raw","role":"adjustable","min_g":50,"max_g":150,"integer_unit_g":50},{"ingredient":"clara-huevo","grams":66,"state":"raw","role":"adjustable","min_g":0,"max_g":165,"integer_unit_g":33},{"ingredient":"espinaca","grams":40,"state":"raw","role":"adjustable","min_g":20,"max_g":100},{"ingredient":"champinones","grams":60,"state":"raw","role":"adjustable","min_g":30,"max_g":150},{"ingredient":"queso-gauda","grams":15,"state":"as_sold","role":"adjustable","min_g":0,"max_g":30},{"ingredient":"aceite-oliva","grams":3,"state":"as_sold","role":"adjustable","min_g":2,"max_g":6},{"ingredient":"sal","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"pan-integral","grams":32,"state":"as_sold","role":"side","min_g":0,"max_g":64,"integer_unit_g":32}]'::jsonb),
  ('wrap-pollo-palta', 'Wrap de pollo, palta y yogur', 'cenas', array['alta en proteínas', 'rápida']::text[], 20, 1, false, null, 'Cocina el pollo a la plancha y córtalo en tiras. Mezcla el yogur con el limón y la sal. Calienta la tortilla en un sartén seco, unta el yogur, agrega lechuga, tomate, palta y pollo, y enrolla apretando los bordes.', '[{"ingredient":"tortilla-harina","grams":48,"state":"as_sold","role":"side","min_g":48,"max_g":96,"integer_unit_g":48},{"ingredient":"pechuga-pollo","grams":100,"state":"raw","role":"adjustable","min_g":60,"max_g":200},{"ingredient":"lechuga","grams":30,"state":"raw","role":"adjustable","min_g":15,"max_g":80},{"ingredient":"tomate","grams":50,"state":"raw","role":"adjustable","min_g":25,"max_g":120},{"ingredient":"palta","grams":30,"state":"raw","role":"adjustable","min_g":0,"max_g":60},{"ingredient":"yogur-griego","grams":30,"state":"as_sold","role":"adjustable","min_g":0,"max_g":60},{"ingredient":"jugo-limon","grams":3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":0.5,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('zapallitos-rellenos', 'Zapallitos italianos rellenos', 'cenas', array['alta en proteínas', 'sin gluten']::text[], 45, 1, false, null, 'Corta los zapallitos a lo largo y vacíalos con una cuchara, dejando 1 cm de pared. Pica la pulpa y sofríela con la cebolla en el aceite; agrega la carne, el tomate picado, orégano y sal y cocina 8 minutos. Rellena, espolvorea el parmesano y hornea a 190 °C por 25 minutos.', '[{"ingredient":"zapallo-italiano","grams":200,"state":"raw","role":"adjustable","min_g":150,"max_g":350},{"ingredient":"carne-molida-5","grams":90,"state":"raw","role":"adjustable","min_g":60,"max_g":180},{"ingredient":"cebolla","grams":30,"state":"raw","role":"adjustable","min_g":15,"max_g":60},{"ingredient":"tomate","grams":50,"state":"raw","role":"adjustable","min_g":25,"max_g":100},{"ingredient":"queso-parmesano","grams":8,"state":"as_sold","role":"adjustable","min_g":0,"max_g":15},{"ingredient":"aceite-oliva","grams":4,"state":"as_sold","role":"adjustable","min_g":2,"max_g":8},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":0.8,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('ensalada-garbanzos-pollo', 'Ensalada de garbanzos, pollo y verduras', 'cenas', array['alta en proteínas', 'rápida', 'sin gluten', 'sin lactosa']::text[], 15, 1, false, null, 'Cocina el pollo a la plancha y córtalo en cubos. Mezcla los garbanzos cocidos y escurridos con el tomate, el pepino, la cebolla en pluma, la lechuga y el perejil. Aliña con aceite, limón y sal justo antes de servir.', '[{"ingredient":"garbanzos","grams":120,"state":"cooked","role":"adjustable","min_g":60,"max_g":220},{"ingredient":"pechuga-pollo","grams":100,"state":"raw","role":"adjustable","min_g":60,"max_g":200},{"ingredient":"tomate","grams":80,"state":"raw","role":"adjustable","min_g":40,"max_g":150},{"ingredient":"pepino","grams":60,"state":"raw","role":"adjustable","min_g":30,"max_g":120},{"ingredient":"lechuga","grams":40,"state":"raw","role":"adjustable","min_g":20,"max_g":100},{"ingredient":"cebolla","grams":15,"state":"raw","role":"fixed"},{"ingredient":"perejil","grams":3,"state":"raw","role":"fixed"},{"ingredient":"aceite-oliva","grams":8,"state":"as_sold","role":"ratio","ratio_group":"aliño"},{"ingredient":"jugo-limon","grams":10,"state":"as_sold","role":"ratio","ratio_group":"aliño"},{"ingredient":"sal","grams":0.8,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('crema-zapallo', 'Crema de zapallo', 'cenas', array['batch cooking', 'congelable', 'económica', 'vegetariana']::text[], 35, 4, true, 2000, 'Sofríe la cebolla en el aceite, agrega zapallo y papa en cubos y cubre apenas con agua. Cocina 20 minutos hasta que todo esté blando, licúa con la leche y ajusta con sal y pimienta. Pesa la olla. Se congela bien en porciones.', '[{"ingredient":"zapallo-camote","grams":200,"state":"raw","role":"adjustable"},{"ingredient":"papa","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"leche-descremada","grams":80,"state":"as_sold","role":"adjustable"},{"ingredient":"aceite-oliva","grams":4,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"pimienta","grams":0.2,"state":"as_sold","role":"fixed"},{"ingredient":"pan-integral","grams":32,"state":"as_sold","role":"side","min_g":0,"max_g":64,"integer_unit_g":32}]'::jsonb),
  ('tortilla-verduras', 'Tortilla de papas y zapallo italiano', 'cenas', array['sin gluten', 'sin lactosa', 'vegetariana']::text[], 35, 4, true, null, 'Corta papas y zapallo en láminas finas y cocínalos tapados con la cebolla y el aceite a fuego bajo 15 minutos, sin dorar. Mezcla con los huevos batidos, sal y pimienta y cuaja en un sartén mediano a fuego bajo; da vuelta con un plato y termina 3 minutos. Pesa la tortilla entera y reparte por peso. La ensalada va aparte.', '[{"ingredient":"huevo","grams":100,"state":"raw","role":"adjustable"},{"ingredient":"papa","grams":120,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":40,"state":"raw","role":"adjustable"},{"ingredient":"zapallo-italiano","grams":80,"state":"raw","role":"adjustable"},{"ingredient":"aceite-oliva","grams":6,"state":"as_sold","role":"adjustable"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"pimienta","grams":0.2,"state":"as_sold","role":"fixed"},{"ingredient":"lechuga","grams":50,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"tomate","grams":60,"state":"raw","role":"side","min_g":0,"max_g":150}]'::jsonb),
  ('pollo-plancha-arroz-integral-brocoli', 'Pollo a la plancha con arroz integral y brócoli', 'cenas', array['alta en proteínas', 'sin gluten', 'sin lactosa']::text[], 35, 1, false, null, 'Cocina el arroz integral (unos 35 minutos). Aplana la pechuga, adóbala con ajo, limón y sal y cocínala en plancha caliente 4 a 5 minutos por lado. Cuece el brócoli al vapor 4 minutos y aliña con el aceite.', '[{"ingredient":"pechuga-pollo","grams":150,"state":"raw","role":"adjustable","min_g":100,"max_g":280},{"ingredient":"arroz-integral","grams":60,"state":"raw","role":"side","min_g":0,"max_g":120},{"ingredient":"brocoli","grams":120,"state":"raw","role":"adjustable","min_g":60,"max_g":250},{"ingredient":"aceite-oliva","grams":6,"state":"as_sold","role":"adjustable","min_g":3,"max_g":10},{"ingredient":"jugo-limon","grams":5,"state":"as_sold","role":"fixed"},{"ingredient":"ajo","grams":2,"state":"raw","role":"fixed"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('pizza-tortilla', 'Pizza rápida en tortilla', 'cenas', array['rápida', 'vegetariana']::text[], 15, 1, false, null, 'Precalienta el horno a 220 °C. Pon la tortilla en una lata, cúbrela con la salsa, el queso, los champiñones laminados y el pimentón en tiras. Hornea 7 a 9 minutos, hasta que los bordes estén crujientes. Termina con orégano.', '[{"ingredient":"tortilla-harina","grams":48,"state":"as_sold","role":"side","min_g":48,"max_g":96,"integer_unit_g":48},{"ingredient":"salsa-tomate","grams":40,"state":"as_sold","role":"adjustable","min_g":20,"max_g":80},{"ingredient":"queso-mozzarella","grams":40,"state":"as_sold","role":"adjustable","min_g":20,"max_g":80},{"ingredient":"champinones","grams":40,"state":"raw","role":"adjustable","min_g":0,"max_g":100},{"ingredient":"pimenton-verde","grams":30,"state":"raw","role":"adjustable","min_g":0,"max_g":80},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('manzana-mantequilla-mani', 'Manzana con mantequilla de maní', 'snacks', array['rápida', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 3, 1, false, null, 'Corta la manzana en gajos y acompaña con la mantequilla de maní para untar.', '[{"ingredient":"manzana","grams":150,"state":"raw","role":"adjustable","min_g":100,"max_g":220},{"ingredient":"mantequilla-mani","grams":16,"state":"as_sold","role":"adjustable","min_g":8,"max_g":32}]'::jsonb),
  ('huevos-duros', 'Huevos duros', 'snacks', array['alta en proteínas', 'batch cooking', 'rápida', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 12, 1, false, null, 'Pon los huevos en agua hirviendo 10 minutos y pásalos a agua con hielo. Sin pelar, duran 5 días refrigerados.', '[{"ingredient":"huevo","grams":100,"state":"raw","role":"adjustable","min_g":50,"max_g":150,"integer_unit_g":50},{"ingredient":"sal","grams":0.3,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('frutos-secos-kiwi', 'Frutos secos con kiwi', 'snacks', array['rápida', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 2, 1, false, null, 'Porciona los frutos secos en un pocillo y acompaña con el kiwi pelado.', '[{"ingredient":"almendras","grams":15,"state":"as_sold","role":"adjustable","min_g":5,"max_g":30},{"ingredient":"nueces","grams":10,"state":"as_sold","role":"adjustable","min_g":0,"max_g":20},{"ingredient":"kiwi","grams":69,"state":"raw","role":"side","min_g":0,"max_g":138,"integer_unit_g":69}]'::jsonb),
  ('hummus-palitos', 'Hummus con palitos de zanahoria y apio', 'snacks', array['batch cooking', 'rápida', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 10, 4, true, null, 'Procesa los garbanzos cocidos con el ajo, el limón, el comino y la sal, agregando el aceite y un poco de agua fría hasta lograr una crema lisa. Pesa el hummus terminado. Corta zanahoria y apio en bastones.', '[{"ingredient":"garbanzos","grams":80,"state":"cooked","role":"adjustable"},{"ingredient":"aceite-oliva","grams":8,"state":"as_sold","role":"adjustable"},{"ingredient":"jugo-limon","grams":10,"state":"as_sold","role":"adjustable"},{"ingredient":"ajo","grams":2,"state":"raw","role":"fixed"},{"ingredient":"comino","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":0.5,"state":"as_sold","role":"fixed"},{"ingredient":"zanahoria","grams":80,"state":"raw","role":"side","min_g":0,"max_g":150},{"ingredient":"apio","grams":50,"state":"raw","role":"side","min_g":0,"max_g":120}]'::jsonb),
  ('yogur-durazno-chia', 'Yogur con durazno y chía', 'snacks', array['rápida', 'sin gluten', 'vegetariana']::text[], 3, 1, false, null, 'Mezcla el yogur con la chía y deja 5 minutos para que se hidrate. Agrega el durazno en cubos.', '[{"ingredient":"yogur-natural","grams":170,"state":"as_sold","role":"adjustable","min_g":120,"max_g":250},{"ingredient":"durazno","grams":100,"state":"raw","role":"side","min_g":0,"max_g":180},{"ingredient":"chia","grams":5,"state":"as_sold","role":"adjustable","min_g":0,"max_g":12}]'::jsonb),
  ('manzana-asada-canela', 'Manzana asada con canela y yogur', 'postres', array['sin gluten', 'vegetariana']::text[], 30, 1, false, null, 'Saca el centro de la manzana, rellena con canela y miel y hornea a 180 °C por 25 minutos. Sirve tibia con el yogur.', '[{"ingredient":"manzana","grams":180,"state":"raw","role":"adjustable","min_g":120,"max_g":250},{"ingredient":"canela","grams":1,"state":"as_sold","role":"fixed"},{"ingredient":"miel","grams":5,"state":"as_sold","role":"adjustable","min_g":0,"max_g":10},{"ingredient":"yogur-griego","grams":60,"state":"as_sold","role":"side","min_g":0,"max_g":120}]'::jsonb),
  ('yogur-cacao-frambuesas', 'Yogur griego con cacao y frambuesas', 'postres', array['alta en proteínas', 'rápida', 'sin gluten', 'vegetariana']::text[], 3, 1, false, null, 'Mezcla el yogur con el cacao y la miel hasta que no queden grumos. Sirve con las frambuesas encima.', '[{"ingredient":"yogur-griego","grams":170,"state":"as_sold","role":"adjustable","min_g":100,"max_g":250},{"ingredient":"cacao","grams":5,"state":"as_sold","role":"adjustable","min_g":3,"max_g":10},{"ingredient":"miel","grams":8,"state":"as_sold","role":"adjustable","min_g":0,"max_g":12},{"ingredient":"frambuesas","grams":60,"state":"raw","role":"side","min_g":0,"max_g":120}]'::jsonb),
  ('salsa-pomodoro', 'Salsa pomodoro casera', 'preparaciones_base', array['batch cooking', 'congelable', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 35, 6, true, 870, 'Sofríe la cebolla picada muy fina en el aceite a fuego bajo 8 minutos y agrega el ajo un minuto. Incorpora el tomate aplastado y cocina destapado 20 a 25 minutos, hasta que reduzca y espese. Sala, agrega la albahaca al final y pesa la salsa. Se congela en porciones.', '[{"ingredient":"tomate-conserva","grams":150,"state":"as_sold","role":"adjustable"},{"ingredient":"cebolla","grams":20,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":3,"state":"raw","role":"fixed"},{"ingredient":"aceite-oliva","grams":5,"state":"as_sold","role":"adjustable"},{"ingredient":"albahaca","grams":2,"state":"raw","role":"fixed"},{"ingredient":"sal","grams":1,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('arroz-graneado', 'Arroz graneado', 'preparaciones_base', array['batch cooking', 'congelable', 'sin gluten', 'sin lactosa', 'vegetariana']::text[], 25, 6, true, null, 'Lava el arroz hasta que el agua salga clara. Dóralo un par de minutos en el aceite con el ajo, agrega el doble de su volumen en agua hirviendo con sal y cocina tapado a fuego mínimo 15 minutos. Reposa 5 minutos, suelta con tenedor y pesa el arroz cocido.', '[{"ingredient":"arroz","grams":60,"state":"raw","role":"adjustable"},{"ingredient":"aceite-vegetal","grams":2,"state":"as_sold","role":"adjustable"},{"ingredient":"ajo","grams":1,"state":"raw","role":"fixed"},{"ingredient":"sal","grams":0.8,"state":"as_sold","role":"fixed"}]'::jsonb),
  ('pollo-desmenuzado', 'Pollo desmenuzado para la semana', 'preparaciones_base', array['alta en proteínas', 'batch cooking', 'congelable', 'sin gluten', 'sin lactosa']::text[], 35, 6, true, null, 'Cuece las pechugas en agua apenas hirviendo con cebolla, zanahoria, ajo, orégano y sal, 15 a 18 minutos. Deja enfriar en el caldo, desmenuza con dos tenedores y pesa el pollo escurrido. Sirve para wraps, ensaladas y salteados durante la semana.', '[{"ingredient":"pechuga-pollo","grams":150,"state":"raw","role":"adjustable"},{"ingredient":"cebolla","grams":20,"state":"raw","role":"adjustable"},{"ingredient":"zanahoria","grams":20,"state":"raw","role":"adjustable"},{"ingredient":"ajo","grams":2,"state":"raw","role":"fixed"},{"ingredient":"oregano","grams":0.3,"state":"as_sold","role":"fixed"},{"ingredient":"sal","grams":0.8,"state":"as_sold","role":"fixed"}]'::jsonb)
) as v(slug, name, category, tags, prep, servings, homog, yield_g, instructions, lines)
on conflict (slug) do update set
  name = excluded.name, category = excluded.category, tags = excluded.tags, prep_minutes = excluded.prep_minutes,
  servings_nominal = excluded.servings_nominal, is_homogeneous = excluded.is_homogeneous,
  expected_cooked_yield_g = excluded.expected_cooked_yield_g, instructions = excluded.instructions,
  lines = excluded.lines, catalog_version = public.recipe_catalog.catalog_version + 1, updated_at = now();

-- Cada hogar existente recibe las recetas del catálogo que le falten
select public._import_catalog_recipes(h.id) from public.households h;

-- ═══════════ supabase/migrations/20261024000008_week_menu.sql ═══════════
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

-- ═══════════ supabase/seed.sql ═══════════
-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · Datos iniciales
-- Tabla de intercambios por defecto: valores de uso habitual en pautas
-- chilenas, marcados como ESTIMADOS. Cada hogar puede reemplazarlos por los
-- de su propia pauta (exchange_groups con household_id).
-- No se cargan recetas ni ingredientes ficticios.
-- ════════════════════════════════════════════════════════════════════════

insert into public.exchange_groups (household_id, code, label, kcal, protein_g, carbs_g, fat_g, reference, confidence) values
  (null, 'cereales',                'Cereales, papas y legumbres frescas', 140, 3,  30,  1,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'verduras_general',        'Verduras de consumo general',          30, 2,   5,  0,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'verduras_libre',          'Verduras de libre consumo',            10, 1, 2.5,  0,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'frutas',                  'Frutas',                               65, 1,  15,  0,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'carnes_altas_grasa',      'Carnes altas en grasa',               120, 11,  1,  8,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'carnes_bajas_grasa',      'Carnes bajas en grasa',                65, 11,  1,  2,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'legumbres',               'Leguminosas',                         170, 11, 30,  1,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'lacteos_altos_grasa',     'Lácteos altos en grasa',              110, 5,   9,  6,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'lacteos_medios_grasa',    'Lácteos medios en grasa',              85, 5,   9,  3,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'lacteos_bajos_grasa',     'Lácteos bajos en grasa',               70, 7,  10,  0,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'aceites_grasas',          'Aceites y grasas',                    180, 0,   0, 20,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'alimentos_ricos_lipidos', 'Alimentos ricos en lípidos',          175, 3,   5, 15,  'Valores de uso habitual; verificar con la pauta', 'estimated'),
  (null, 'azucares',                'Azúcares',                             20, 0,   5,  0,  'Valores de uso habitual; verificar con la pauta', 'estimated')
on conflict do nothing;
