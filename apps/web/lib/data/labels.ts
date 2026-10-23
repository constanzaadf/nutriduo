/** Etiquetas en español compartidas por servidor y cliente. */
export const INGREDIENT_CATEGORIES: [string, string][] = [
  ["carnes", "Carnes"], ["pescados", "Pescados"], ["huevos", "Huevos"], ["lacteos", "Lácteos"], ["cereales", "Cereales y pastas"],
  ["legumbres", "Legumbres"], ["verduras", "Verduras"], ["frutas", "Frutas"], ["grasas", "Aceites y grasas"], ["frutos_secos", "Frutos secos y semillas"],
  ["condimentos", "Condimentos"], ["panaderia", "Panadería"], ["bebidas", "Bebidas"], ["otros", "Otros"],
];
export const EXCHANGE_GROUPS: [string, string][] = [
  ["cereales", "Cereales"], ["verduras_general", "Verduras consumo general"], ["verduras_libre", "Verduras libre consumo"], ["frutas", "Frutas"],
  ["carnes_altas_grasa", "Carnes altas en grasa"], ["carnes_bajas_grasa", "Carnes bajas en grasa"], ["legumbres", "Leguminosas"],
  ["lacteos_altos_grasa", "Lácteos altos en grasa"], ["lacteos_medios_grasa", "Lácteos medios en grasa"], ["lacteos_bajos_grasa", "Lácteos bajos en grasa"],
  ["aceites_grasas", "Aceites y grasas"], ["alimentos_ricos_lipidos", "Ricos en lípidos"], ["azucares", "Azúcares"],
];
export const FOOD_STATE_LABEL: Record<string, string> = { raw: "crudo", cooked: "cocido", as_sold: "como se vende" };
