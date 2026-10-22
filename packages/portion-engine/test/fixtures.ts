/**
 * DATOS DE PRUEBA. Valores redondeados y plausibles para ejercitar el motor;
 * no son una tabla de referencia ni se usan en la app.
 */
import type { Ingredient, RecipeVersion } from "@nutriduo/domain";

const row = (kcal: number, p: number, c: number, f: number, fib = 0, na: number | null = 0) => ({
  per100g: { kcal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fib, sodium_mg: na },
  source: "manual" as const,
  sourceRef: "fixture",
  confidence: "calculated" as const,
});

export const ING: Record<string, Ingredient> = {
  pasta: { id: "pasta", name: "Pasta seca", category: "cereales", nutrition: { raw: row(360, 12.5, 72, 1.5, 3, 5) }, yieldFactors: { default: 2.4 }, exchangeGroup: "cereales", exchangeGrams: 40, exchangeState: "raw", allergenTags: ["gluten"] },
  carne: { id: "carne", name: "Carne molida 5 %", category: "carnes", nutrition: { raw: row(137, 21, 0, 5.5, 0, 66) }, yieldFactors: { default: 0.75 }, exchangeGroup: "carnes_bajas_grasa", exchangeGrams: 50, exchangeState: "raw" },
  tomate: { id: "tomate", name: "Salsa de tomate", category: "verduras", nutrition: { as_sold: row(30, 1.5, 5, 0.3, 1.5, 400) }, exchangeGroup: "verduras_general", exchangeGrams: 150, exchangeState: "as_sold" },
  cebolla: { id: "cebolla", name: "Cebolla", category: "verduras", nutrition: { raw: row(40, 1.1, 9, 0.1, 1.7, 4) }, yieldFactors: { default: 0.8 }, exchangeGroup: "verduras_general", exchangeGrams: 100, exchangeState: "raw" },
  aceite: { id: "aceite", name: "Aceite de oliva", category: "grasas", nutrition: { as_sold: row(884, 0, 0, 100, 0, 0) }, exchangeGroup: "aceites_grasas", exchangeGrams: 20, exchangeState: "as_sold" },
  pollo: { id: "pollo", name: "Pechuga de pollo", category: "carnes", nutrition: { raw: row(120, 22.5, 0, 2.6, 0, 45) }, yieldFactors: { default: 0.75 }, exchangeGroup: "carnes_bajas_grasa", exchangeGrams: 50, exchangeState: "raw" },
  arroz: { id: "arroz", name: "Arroz", category: "cereales", nutrition: { raw: row(360, 7, 79, 0.6, 1.3, 1) }, yieldFactors: { default: 2.8 }, exchangeGroup: "cereales", exchangeGrams: 40, exchangeState: "raw" },
  lechuga: { id: "lechuga", name: "Lechuga", category: "verduras", nutrition: { raw: row(15, 1.4, 2.9, 0.2, 1.3, 28) }, exchangeGroup: "verduras_libre", exchangeGrams: 50, exchangeState: "raw" },
  papa: { id: "papa", name: "Papa", category: "verduras", nutrition: { raw: row(77, 2, 17, 0.1, 2.2, 6) }, yieldFactors: { default: 0.9 }, exchangeGroup: "cereales", exchangeGrams: 150, exchangeState: "raw" },
  pan: { id: "pan", name: "Pan de hamburguesa", category: "panaderia", nutrition: { as_sold: row(270, 9, 48, 4, 2.5, 480) }, unitWeightG: 60, exchangeGroup: "cereales", exchangeGrams: 50, exchangeState: "as_sold", allergenTags: ["gluten"] },
  queso: { id: "queso", name: "Queso laminado", category: "lacteos", nutrition: { as_sold: row(330, 20, 2, 27, 0, 900) }, unitWeightG: 20, exchangeGroup: "lacteos_altos_grasa", exchangeGrams: 30, exchangeState: "as_sold", allergenTags: ["lactosa"] },
  comino: { id: "comino", name: "Comino", category: "condimentos", nutrition: { as_sold: row(375, 18, 44, 22, 10, 170) } },
};

export const ingredients: ReadonlyMap<string, Ingredient> = new Map(Object.entries(ING));

/** Tallarines boloñesa: salsa homogénea + pasta como acompañamiento separable. */
export const bolognese: RecipeVersion = {
  id: "bolo-v1",
  recipeId: "bolo",
  parentVersionId: null,
  origin: "original",
  name: "Tallarines boloñesa",
  servingsNominal: 4,
  isHomogeneous: true,
  lines: [
    { ingredientId: "carne", grams: 125, state: "raw", role: "adjustable" },
    { ingredientId: "tomate", grams: 100, state: "as_sold", role: "adjustable" },
    { ingredientId: "cebolla", grams: 40, state: "raw", role: "adjustable" },
    { ingredientId: "aceite", grams: 5, state: "as_sold", role: "adjustable" },
    { ingredientId: "pasta", grams: 90, state: "raw", role: "side" },
  ],
};

/** Pollo con arroz y ensalada: todo separable. */
export const chickenRice: RecipeVersion = {
  id: "pollo-v1",
  recipeId: "pollo",
  parentVersionId: null,
  origin: "original",
  name: "Pollo con arroz y ensalada",
  servingsNominal: 1,
  isHomogeneous: false,
  lines: [
    { ingredientId: "pollo", grams: 150, state: "raw", role: "adjustable" },
    { ingredientId: "arroz", grams: 70, state: "raw", role: "side" },
    { ingredientId: "lechuga", grams: 80, state: "raw", role: "adjustable" },
    { ingredientId: "aceite", grams: 8, state: "as_sold", role: "adjustable" },
    { ingredientId: "comino", grams: 1, state: "as_sold", role: "fixed" },
  ],
};

/** Hamburguesa casera: hamburguesas enteras de 85 g crudos. */
export const burger: RecipeVersion = {
  id: "burger-v1",
  recipeId: "burger",
  parentVersionId: null,
  origin: "original",
  name: "Hamburguesas caseras",
  servingsNominal: 1,
  isHomogeneous: false,
  lines: [
    { ingredientId: "carne", grams: 170, state: "raw", role: "adjustable", integerUnitG: 85, minG: 85, maxG: 255 },
    { ingredientId: "papa", grams: 150, state: "raw", role: "side" },
    { ingredientId: "lechuga", grams: 60, state: "raw", role: "side" },
  ],
};

/** Ensalada con aliño en grupo de proporción. */
export const dressedSalad: RecipeVersion = {
  id: "salad-v1",
  recipeId: "salad",
  parentVersionId: null,
  origin: "original",
  name: "Ensalada de pollo",
  servingsNominal: 1,
  isHomogeneous: false,
  lines: [
    { ingredientId: "pollo", grams: 120, state: "raw", role: "adjustable" },
    { ingredientId: "lechuga", grams: 100, state: "raw", role: "adjustable" },
    { ingredientId: "aceite", grams: 10, state: "as_sold", role: "ratio", ratioGroup: "alino" },
    { ingredientId: "tomate", grams: 30, state: "as_sold", role: "ratio", ratioGroup: "alino" },
  ],
};
