/** Reporte de control: porción nominal y resultado del motor para dos perfiles tipo. */
import { solvePortions } from "@nutriduo/portion-engine";
import { CATALOG_RECIPES, buildCatalog, catalogIngredientMap, recipeTags, toRecipeVersion } from "@nutriduo/catalog";
import { nominalServing } from "@nutriduo/portion-engine";

const ings = catalogIngredientMap();
const share: Record<string, number> = { desayunos: 0.25, almuerzos: 0.3, cenas: 0.25, snacks: 0.1, postres: 0.1, preparaciones_base: 0.3 };
const A = { kcal: 1600, protein_g: 120, carbs_g: 155, fat_g: 50 };
const B = { kcal: 2700, protein_g: 155, carbs_g: 330, fat_g: 85 };
const scale = (d: typeof A, f: number) => ({ kcal: d.kcal * f, protein_g: d.protein_g * f, carbs_g: d.carbs_g * f, fat_g: d.fat_g * f });
const fmt = (n: number) => String(Math.round(n)).padStart(4);
for (const r of CATALOG_RECIPES) {
  const v = toRecipeVersion(r);
  const s = nominalServing(v, ings);
  const res = [["A", "fat_loss", scale(A, share[r.category]!)], ["B", "muscle_gain", scale(B, share[r.category]!)]] as const;
  const out = res.map(([n, goal, budget]) => {
    const p = solvePortions({ participantId: n, recipe: v, ingredients: ings, target: { mode: "macros", budget }, goal });
    const d = (k: string) => (p.deviations[k] ? Math.round(p.deviations[k]!.rel * 100) : NaN);
    return `${n}:${p.status.slice(0, 10).padEnd(10)} k${String(d("kcal")).padStart(4)}% p${String(d("protein_g")).padStart(4)}%`;
  });
  console.log(`${r.slug.padEnd(38)} ${fmt(s.nutrients.kcal)}kcal P${fmt(s.nutrients.protein_g)} C${fmt(s.nutrients.carbs_g)} F${fmt(s.nutrients.fat_g)} plato${fmt(s.plateG)}g ${s.missing.length ? "FALTA" : ""} | ${out.join(" | ")}`);
}
console.log("\nIngredientes:", buildCatalog().size);
for (const b of buildCatalog().values()) if (b.yieldFactor) process.stdout.write(`${b.def.slug}×${b.yieldFactor} `);
console.log("\n");
for (const b of buildCatalog().values()) if (b.exchangeGrams) process.stdout.write(`${b.def.slug}=${b.exchangeGrams}g(${b.def.exchange}) `);
console.log("\n\nTags:", CATALOG_RECIPES.slice(0, 6).map((r) => `${r.slug}: ${recipeTags(r).join(", ")}`).join("\n"));
