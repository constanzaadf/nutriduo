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
