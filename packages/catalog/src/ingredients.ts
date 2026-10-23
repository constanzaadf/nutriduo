import type { ExchangeGroupCode, FoodState, IngredientCategory } from "@nutriduo/domain";

/**
 * Catálogo base de ingredientes. Los valores nutricionales NO se escriben a
 * mano: salen de USDA SR28 (NDB indicado), extraídos a data/sr28-extract.json.
 *
 * - yield: cómo se estima el rendimiento crudo → cocido a partir de la fila
 *   cocida de SR28: "dry_matter" (cereales, legumbres, tubérculos: se conserva
 *   la materia seca) o "protein" (carnes: se conserva la proteína).
 * - exchange: grupo de intercambio; los gramos por porción se derivan del
 *   nutriente que define al grupo (ver build.ts). Son estimaciones: cada hogar
 *   puede ajustarlos a su pauta.
 * - unitG: solo cuando SR28 trae ese peso por unidad (se verifica al generar).
 */
export interface CatalogIngredientDef {
  slug: string;
  name: string;
  category: IngredientCategory;
  state: FoodState;
  ndb: string;
  cookedNdb?: string;
  yield?: "dry_matter" | "protein";
  exchange?: ExchangeGroupCode;
  unitG?: number;
  allergens?: string[];
  note?: string;
}

export const CATALOG_INGREDIENTS: CatalogIngredientDef[] = [
  // ─────────── Carnes y huevos ───────────
  { slug: "pechuga-pollo", name: "Pechuga de pollo sin piel", category: "carnes", state: "raw", ndb: "05062", cookedNdb: "05064", yield: "protein", exchange: "carnes_bajas_grasa" },
  { slug: "trutro-pollo", name: "Trutro de pollo deshuesado sin piel", category: "carnes", state: "raw", ndb: "05096", cookedNdb: "05098", yield: "protein", exchange: "carnes_bajas_grasa" },
  { slug: "carne-molida-5", name: "Carne molida 5 % grasa", category: "carnes", state: "raw", ndb: "23557", cookedNdb: "23560", yield: "protein", exchange: "carnes_bajas_grasa" },
  { slug: "carne-molida-10", name: "Carne molida 10 % grasa", category: "carnes", state: "raw", ndb: "23562", cookedNdb: "23565", yield: "protein", exchange: "carnes_altas_grasa" },
  { slug: "posta-negra", name: "Posta negra (vacuno magro)", category: "carnes", state: "raw", ndb: "23357", cookedNdb: "23378", yield: "protein", exchange: "carnes_bajas_grasa" },
  { slug: "carne-guisar", name: "Carne magra para guisar (sobrecostilla)", category: "carnes", state: "raw", ndb: "23603", cookedNdb: "23602", yield: "protein", exchange: "carnes_bajas_grasa" },
  { slug: "huevo", name: "Huevo", category: "huevos", state: "raw", ndb: "01123", exchange: "carnes_altas_grasa", unitG: 50, allergens: ["huevo"] },
  { slug: "clara-huevo", name: "Clara de huevo", category: "huevos", state: "raw", ndb: "01124", exchange: "carnes_bajas_grasa", unitG: 33, allergens: ["huevo"] },
  { slug: "proteina-whey", name: "Proteína de suero en polvo (whey)", category: "otros", state: "as_sold", ndb: "14066", exchange: "carnes_bajas_grasa", allergens: ["lactosa"], note: "Valor genérico: las marcas varían, reemplázalo por la etiqueta de la tuya." },

  // ─────────── Lácteos y quesos ───────────
  { slug: "leche-descremada", name: "Leche descremada", category: "lacteos", state: "as_sold", ndb: "01085", exchange: "lacteos_bajos_grasa", allergens: ["lactosa"] },
  { slug: "leche-semidescremada", name: "Leche semidescremada", category: "lacteos", state: "as_sold", ndb: "01082", exchange: "lacteos_medios_grasa", allergens: ["lactosa"] },
  { slug: "yogur-natural", name: "Yogur natural descremado", category: "lacteos", state: "as_sold", ndb: "01118", exchange: "lacteos_bajos_grasa", allergens: ["lactosa"] },
  { slug: "yogur-griego", name: "Yogur griego natural descremado", category: "lacteos", state: "as_sold", ndb: "01256", exchange: "lacteos_bajos_grasa", allergens: ["lactosa"] },
  { slug: "queso-cottage", name: "Queso cottage 1 %", category: "lacteos", state: "as_sold", ndb: "01016", exchange: "carnes_bajas_grasa", allergens: ["lactosa"] },
  { slug: "ricotta", name: "Ricotta semidescremada", category: "lacteos", state: "as_sold", ndb: "01037", exchange: "carnes_altas_grasa", allergens: ["lactosa"] },
  { slug: "queso-gauda", name: "Queso gauda / mantecoso", category: "lacteos", state: "as_sold", ndb: "01022", exchange: "carnes_altas_grasa", allergens: ["lactosa"] },
  { slug: "queso-parmesano", name: "Queso parmesano rallado", category: "lacteos", state: "as_sold", ndb: "01032", exchange: "carnes_altas_grasa", allergens: ["lactosa"] },
  { slug: "queso-mozzarella", name: "Queso mozzarella semidescremado", category: "lacteos", state: "as_sold", ndb: "01028", exchange: "carnes_altas_grasa", allergens: ["lactosa"] },
  { slug: "mantequilla", name: "Mantequilla sin sal", category: "grasas", state: "as_sold", ndb: "01145", exchange: "aceites_grasas", allergens: ["lactosa"] },

  // ─────────── Cereales, pan y tubérculos ───────────
  { slug: "avena", name: "Avena en hojuelas", category: "cereales", state: "raw", ndb: "08120", cookedNdb: "08121", exchange: "cereales", allergens: ["gluten"], note: "La avena suele tener trazas de gluten. Sin rendimiento: se cocina en leche o en masas, no solo en agua." },
  { slug: "arroz", name: "Arroz blanco grano largo", category: "cereales", state: "raw", ndb: "20444", cookedNdb: "20445", yield: "dry_matter", exchange: "cereales" },
  { slug: "arroz-integral", name: "Arroz integral", category: "cereales", state: "raw", ndb: "20036", cookedNdb: "20037", yield: "dry_matter", exchange: "cereales" },
  { slug: "fideos", name: "Fideos / pasta seca", category: "cereales", state: "raw", ndb: "20120", cookedNdb: "20121", yield: "dry_matter", exchange: "cereales", allergens: ["gluten"] },
  { slug: "fideos-integrales", name: "Fideos integrales", category: "cereales", state: "raw", ndb: "20124", cookedNdb: "20125", yield: "dry_matter", exchange: "cereales", allergens: ["gluten"] },
  { slug: "cuscus", name: "Cuscús", category: "cereales", state: "raw", ndb: "20028", cookedNdb: "20029", yield: "dry_matter", exchange: "cereales", allergens: ["gluten"] },
  { slug: "harina", name: "Harina de trigo", category: "cereales", state: "as_sold", ndb: "20081", exchange: "cereales", allergens: ["gluten"] },
  { slug: "pan-integral", name: "Pan integral de molde", category: "panaderia", state: "as_sold", ndb: "18075", exchange: "cereales", unitG: 32, allergens: ["gluten"] },
  { slug: "pan-frances", name: "Pan blanco tipo marraqueta", category: "panaderia", state: "as_sold", ndb: "18029", exchange: "cereales", allergens: ["gluten"], note: "Equivalente SR28: pan francés." },
  { slug: "pan-hamburguesa", name: "Pan de hamburguesa", category: "panaderia", state: "as_sold", ndb: "18350", exchange: "cereales", unitG: 44, allergens: ["gluten"] },
  { slug: "tortilla-harina", name: "Tortilla de harina (wrap)", category: "panaderia", state: "as_sold", ndb: "18364", exchange: "cereales", unitG: 48, allergens: ["gluten"] },
  { slug: "papa", name: "Papa", category: "verduras", state: "raw", ndb: "11352", cookedNdb: "11674", yield: "dry_matter", exchange: "cereales" },
  { slug: "camote", name: "Camote", category: "verduras", state: "raw", ndb: "11507", cookedNdb: "11508", yield: "dry_matter", exchange: "cereales" },
  { slug: "choclo", name: "Choclo (granos)", category: "verduras", state: "raw", ndb: "11167", exchange: "cereales" },
  { slug: "arvejas", name: "Arvejas", category: "verduras", state: "raw", ndb: "11312", exchange: "cereales" },

  // ─────────── Legumbres ───────────
  { slug: "lentejas", name: "Lentejas", category: "legumbres", state: "raw", ndb: "16069", cookedNdb: "16070", yield: "dry_matter", exchange: "legumbres" },
  { slug: "garbanzos", name: "Garbanzos", category: "legumbres", state: "raw", ndb: "16056", cookedNdb: "16057", yield: "dry_matter", exchange: "legumbres" },
  { slug: "porotos-negros", name: "Porotos negros", category: "legumbres", state: "raw", ndb: "16014", cookedNdb: "16015", yield: "dry_matter", exchange: "legumbres" },
  { slug: "porotos", name: "Porotos (tipo coscorrón)", category: "legumbres", state: "raw", ndb: "16019", cookedNdb: "16020", yield: "dry_matter", exchange: "legumbres", note: "Equivalente SR28: cranberry (roman) beans." },

  // ─────────── Verduras ───────────
  { slug: "cebolla", name: "Cebolla", category: "verduras", state: "raw", ndb: "11282", exchange: "verduras_general" },
  { slug: "ajo", name: "Ajo", category: "verduras", state: "raw", ndb: "11215" },
  { slug: "tomate", name: "Tomate", category: "verduras", state: "raw", ndb: "11529", exchange: "verduras_general" },
  { slug: "tomate-conserva", name: "Tomate en conserva", category: "verduras", state: "as_sold", ndb: "11531", exchange: "verduras_general" },
  { slug: "salsa-tomate", name: "Salsa de tomate (passata)", category: "verduras", state: "as_sold", ndb: "11549", exchange: "verduras_general" },
  { slug: "zanahoria", name: "Zanahoria", category: "verduras", state: "raw", ndb: "11124", exchange: "verduras_general" },
  { slug: "zapallo-italiano", name: "Zapallo italiano", category: "verduras", state: "raw", ndb: "11477", exchange: "verduras_libre" },
  { slug: "zapallo-camote", name: "Zapallo camote", category: "verduras", state: "raw", ndb: "11485", exchange: "verduras_general" },
  { slug: "pimenton-rojo", name: "Pimentón rojo", category: "verduras", state: "raw", ndb: "11821", exchange: "verduras_general" },
  { slug: "pimenton-verde", name: "Pimentón verde", category: "verduras", state: "raw", ndb: "11333", exchange: "verduras_libre" },
  { slug: "lechuga", name: "Lechuga", category: "verduras", state: "raw", ndb: "11251", exchange: "verduras_libre" },
  { slug: "espinaca", name: "Espinaca", category: "verduras", state: "raw", ndb: "11457", exchange: "verduras_libre" },
  { slug: "acelga", name: "Acelga", category: "verduras", state: "raw", ndb: "11147", exchange: "verduras_libre" },
  { slug: "brocoli", name: "Brócoli", category: "verduras", state: "raw", ndb: "11090", exchange: "verduras_general" },
  { slug: "coliflor", name: "Coliflor", category: "verduras", state: "raw", ndb: "11135", exchange: "verduras_general" },
  { slug: "champinones", name: "Champiñones", category: "verduras", state: "raw", ndb: "11260", exchange: "verduras_libre" },
  { slug: "pepino", name: "Pepino", category: "verduras", state: "raw", ndb: "11205", exchange: "verduras_libre" },
  { slug: "apio", name: "Apio", category: "verduras", state: "raw", ndb: "11143", exchange: "verduras_libre" },
  { slug: "repollo", name: "Repollo", category: "verduras", state: "raw", ndb: "11109", exchange: "verduras_libre" },
  { slug: "betarraga", name: "Betarraga", category: "verduras", state: "raw", ndb: "11080", exchange: "verduras_general" },
  { slug: "porotos-verdes", name: "Porotos verdes", category: "verduras", state: "raw", ndb: "11052", exchange: "verduras_general" },
  { slug: "cilantro", name: "Cilantro", category: "verduras", state: "raw", ndb: "11165" },
  { slug: "perejil", name: "Perejil", category: "verduras", state: "raw", ndb: "11297" },
  { slug: "albahaca", name: "Albahaca", category: "verduras", state: "raw", ndb: "02044" },

  // ─────────── Frutas ───────────
  { slug: "palta", name: "Palta Hass", category: "frutas", state: "raw", ndb: "09038", exchange: "alimentos_ricos_lipidos" },
  { slug: "platano", name: "Plátano", category: "frutas", state: "raw", ndb: "09040", exchange: "frutas" },
  { slug: "manzana", name: "Manzana", category: "frutas", state: "raw", ndb: "09003", exchange: "frutas" },
  { slug: "naranja", name: "Naranja", category: "frutas", state: "raw", ndb: "09200", exchange: "frutas" },
  { slug: "frutillas", name: "Frutillas", category: "frutas", state: "raw", ndb: "09316", exchange: "frutas" },
  { slug: "arandanos", name: "Arándanos", category: "frutas", state: "raw", ndb: "09050", exchange: "frutas" },
  { slug: "frambuesas", name: "Frambuesas", category: "frutas", state: "raw", ndb: "09302", exchange: "frutas" },
  { slug: "kiwi", name: "Kiwi", category: "frutas", state: "raw", ndb: "09148", exchange: "frutas", unitG: 69 },
  { slug: "pera", name: "Pera", category: "frutas", state: "raw", ndb: "09252", exchange: "frutas" },
  { slug: "durazno", name: "Durazno", category: "frutas", state: "raw", ndb: "09236", exchange: "frutas" },
  { slug: "jugo-limon", name: "Jugo de limón", category: "frutas", state: "as_sold", ndb: "09152" },

  // ─────────── Grasas, frutos secos y semillas ───────────
  { slug: "aceite-oliva", name: "Aceite de oliva", category: "grasas", state: "as_sold", ndb: "04053", exchange: "aceites_grasas" },
  { slug: "aceite-vegetal", name: "Aceite vegetal (maravilla)", category: "grasas", state: "as_sold", ndb: "04506", exchange: "aceites_grasas" },
  { slug: "almendras", name: "Almendras", category: "frutos_secos", state: "as_sold", ndb: "12061", exchange: "alimentos_ricos_lipidos", allergens: ["frutos_secos"] },
  { slug: "nueces", name: "Nueces", category: "frutos_secos", state: "as_sold", ndb: "12155", exchange: "alimentos_ricos_lipidos", allergens: ["frutos_secos"] },
  { slug: "mantequilla-mani", name: "Mantequilla de maní", category: "frutos_secos", state: "as_sold", ndb: "16398", exchange: "alimentos_ricos_lipidos", allergens: ["mani"] },
  { slug: "chia", name: "Semillas de chía", category: "frutos_secos", state: "as_sold", ndb: "12006", exchange: "alimentos_ricos_lipidos" },

  // ─────────── Despensa y condimentos ───────────
  { slug: "miel", name: "Miel", category: "otros", state: "as_sold", ndb: "19296", exchange: "azucares" },
  { slug: "azucar", name: "Azúcar", category: "otros", state: "as_sold", ndb: "19335", exchange: "azucares" },
  { slug: "cacao", name: "Cacao amargo en polvo", category: "otros", state: "as_sold", ndb: "19165" },
  { slug: "sal", name: "Sal", category: "condimentos", state: "as_sold", ndb: "02047" },
  { slug: "pimienta", name: "Pimienta negra", category: "condimentos", state: "as_sold", ndb: "02030" },
  { slug: "comino", name: "Comino", category: "condimentos", state: "as_sold", ndb: "02014" },
  { slug: "oregano", name: "Orégano", category: "condimentos", state: "as_sold", ndb: "02027" },
  { slug: "aji-color", name: "Ají de color (pimentón dulce)", category: "condimentos", state: "as_sold", ndb: "02028" },
  { slug: "aji-cayena", name: "Ají en polvo (cayena)", category: "condimentos", state: "as_sold", ndb: "02031" },
  { slug: "canela", name: "Canela molida", category: "condimentos", state: "as_sold", ndb: "02010" },
  { slug: "salsa-soya", name: "Salsa de soya", category: "condimentos", state: "as_sold", ndb: "16124", allergens: ["soya"] },
  { slug: "vinagre", name: "Vinagre", category: "condimentos", state: "as_sold", ndb: "02053" },
  { slug: "mostaza", name: "Mostaza", category: "condimentos", state: "as_sold", ndb: "02046" },
  { slug: "polvos-hornear", name: "Polvos de hornear", category: "condimentos", state: "as_sold", ndb: "18369" },
  { slug: "caldo-verduras", name: "Caldo de verduras", category: "condimentos", state: "as_sold", ndb: "06615" },
];
