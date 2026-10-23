import type { RecipeVersion } from "@nutriduo/domain";
import { nominalServing } from "@nutriduo/portion-engine";
import { buildCatalog, catalogIngredientMap } from "./build";
import type { CatalogRecipeDef } from "./recipes";

/** Convierte una receta del catálogo a una versión del dominio (ids = slugs). */
export function toRecipeVersion(r: CatalogRecipeDef): RecipeVersion {
  const catalog = buildCatalog();
  const v: RecipeVersion = {
    id: `catalog:${r.slug}`,
    recipeId: r.slug,
    parentVersionId: null,
    origin: "original",
    name: r.name,
    servingsNominal: r.servings,
    isHomogeneous: r.homogeneous,
    lines: r.lines.map((l) => {
      const ing = catalog.get(l.ingredient);
      if (!ing) throw new Error(`${r.slug}: ingrediente desconocido "${l.ingredient}"`);
      const line: RecipeVersion["lines"][number] = { ingredientId: l.ingredient, grams: l.grams, state: l.state ?? ing.def.state, role: l.role };
      if (l.minG !== undefined) line.minG = l.minG;
      if (l.maxG !== undefined) line.maxG = l.maxG;
      if (l.ratioGroup) line.ratioGroup = l.ratioGroup;
      if (l.integerUnitG) line.integerUnitG = l.integerUnitG;
      return line;
    }),
  };
  if (r.expectedCookedYieldG) v.expectedCookedYieldG = r.expectedCookedYieldG;
  return v;
}

/** Etiquetas calculadas desde los ingredientes, más las manuales de la receta. */
export function recipeTags(r: CatalogRecipeDef): string[] {
  const catalog = buildCatalog();
  const ings = r.lines.map((l) => catalog.get(l.ingredient)!);
  const allergens = new Set(ings.flatMap((i) => i.def.allergens ?? []));
  const tags = new Set(r.tags);
  if (!ings.some((i) => i.def.category === "carnes")) tags.add("vegetariana");
  if (!allergens.has("lactosa")) tags.add("sin lactosa");
  if (!allergens.has("gluten")) tags.add("sin gluten");
  if (r.prepMinutes <= 20) tags.add("rápida");
  const s = nominalServing(toRecipeVersion(r), catalogIngredientMap());
  if (s.nutrients.kcal > 0 && (s.nutrients.protein_g * 4) / s.nutrients.kcal >= 0.3) tags.add("alta en proteínas");
  return [...tags].sort((a, b) => a.localeCompare(b, "es"));
}
