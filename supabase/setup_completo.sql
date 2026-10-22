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
