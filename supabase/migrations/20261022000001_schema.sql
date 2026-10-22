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
