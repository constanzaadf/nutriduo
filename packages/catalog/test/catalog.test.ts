import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atwaterKcal } from "@nutriduo/domain";
import { solvePortions, nominalServing } from "@nutriduo/portion-engine";
import { CATALOG_INGREDIENTS, CATALOG_RECIPES, SR28, buildCatalog, catalogIngredientMap, recipeTags, toRecipeVersion } from "@nutriduo/catalog";

const catalog = buildCatalog();
const ings = catalogIngredientMap();
const SHARE: Record<string, number> = { desayunos: 0.25, almuerzos: 0.3, cenas: 0.25, snacks: 0.1, postres: 0.1, preparaciones_base: 0.3 };
const A = { kcal: 1600, protein_g: 120, carbs_g: 155, fat_g: 50 };
const B = { kcal: 2700, protein_g: 155, carbs_g: 330, fat_g: 85 };
const scale = (d: typeof A, f: number) => ({ kcal: d.kcal * f, protein_g: d.protein_g * f, carbs_g: d.carbs_g * f, fat_g: d.fat_g * f });

describe("fuente de datos", () => {
  it("el extracto viene del archivo oficial SR28 identificado por su huella", () => {
    assert.match(SR28.source, /SR28/);
    assert.equal(SR28.file_sha256, "4c42235a001efd5e94ce38001682138056aa1b755427b8a8d315c2b02cd2b85b");
  });
  it("cada ingrediente cita su NDB y su descripción original", () => {
    for (const b of catalog.values()) {
      const row = b.nutrition[b.def.state]!;
      assert.equal(row.source, "fdc");
      assert.match(row.sourceRef!, new RegExp(`NDB ${b.def.ndb}: `));
    }
  });
});

describe("ingredientes del catálogo", () => {
  it("al menos 90 ingredientes con slug y nombre únicos", () => {
    assert.equal(catalog.size, CATALOG_INGREDIENTS.length);
    assert.ok(catalog.size >= 90);
  });
  it("respetan las restricciones de la base (macros ≤ 100 g, kcal ≤ 950)", () => {
    for (const b of catalog.values()) {
      for (const row of Object.values(b.nutrition)) {
        const n = row!.per100g;
        assert.ok(n.protein_g + n.carbs_g + n.fat_g <= 100.5, b.def.slug);
        assert.ok(n.kcal <= 950 && n.kcal >= 0, b.def.slug);
      }
    }
  });
  it("la energía declarada es coherente con los macros (Atwater) en alimentos con energía relevante", () => {
    for (const b of catalog.values()) {
      const n = b.nutrition[b.def.state]!.per100g;
      if (n.kcal < 50 || b.def.category === "condimentos") continue; // verduras y especias: la fibra y otros factores pesan más
      if (b.def.slug === "cacao") continue; // SR28 aplica factores específicos del cacao (proteína 1,83; grasa 8,37; carbohidrato 1,33)
      // SR28 usa factores específicos por alimento; se acepta la general o la que descuenta la fibra.
      const total = Math.abs(atwaterKcal(n) - n.kcal) / n.kcal;
      const net = Math.abs(atwaterKcal({ ...n, carbs_g: n.carbs_g - n.fiber_g }) - n.kcal) / n.kcal;
      assert.ok(Math.min(total, net) < 0.15, `${b.def.slug}: Atwater ${Math.round(atwaterKcal(n))} vs ${n.kcal}`);
    }
  });
  it("los rendimientos derivados son plausibles", () => {
    const y = (s: string) => catalog.get(s)!.yieldFactor!;
    assert.ok(y("arroz") > 2.5 && y("arroz") < 3.1);
    assert.ok(y("fideos") > 2.1 && y("fideos") < 2.6);
    assert.ok(y("pechuga-pollo") > 0.65 && y("pechuga-pollo") < 0.8);
    assert.ok(y("lentejas") > 2.4 && y("lentejas") < 3.2);
    assert.equal(catalog.get("avena")!.yieldFactor, null);
  });
  it("todo ingrediente con grupo de intercambio tiene gramos por porción", () => {
    for (const b of catalog.values()) {
      if (b.def.exchange) assert.ok(b.exchangeGrams! > 0, b.def.slug);
      else assert.equal(b.exchangeGrams, null);
    }
    assert.equal(catalog.get("aceite-oliva")!.exchangeGrams, 20);
    assert.equal(catalog.get("arroz")!.exchangeGrams, 38);
  });
  it("no incluye alimentos excluidos del hogar", () => {
    const banned = /pescad|salm[oó]n|at[uú]n|marisc|camar|cerdo|pavo|quinoa|jam[oó]n|tocino/i;
    for (const d of CATALOG_INGREDIENTS) assert.ok(!banned.test(d.name) && !banned.test(d.slug), d.name);
  });
});

describe("recetario base", () => {
  it("al menos 35 recetas con slugs únicos y en todas las categorías", () => {
    assert.equal(new Set(CATALOG_RECIPES.map((r) => r.slug)).size, CATALOG_RECIPES.length);
    assert.ok(CATALOG_RECIPES.length >= 35);
    for (const c of Object.keys(SHARE)) assert.ok(CATALOG_RECIPES.some((r) => r.category === c), c);
  });

  for (const r of CATALOG_RECIPES) {
    describe(r.name, () => {
      const v = toRecipeVersion(r);
      it("cumple las restricciones de la base", () => {
        for (const l of r.lines) {
          assert.ok(l.grams > 0);
          assert.equal(l.role === "ratio", !!l.ratioGroup);
          if (l.minG !== undefined && l.maxG !== undefined) assert.ok(l.minG <= l.maxG);
          if (l.integerUnitG) assert.ok(l.grams % l.integerUnitG === 0, `${l.ingredient}: gramos múltiplo de la unidad`);
        }
        assert.ok(r.instructions.length > 40);
      });
      it("todos sus ingredientes tienen datos en el estado indicado", () => {
        const s = nominalServing(v, ings);
        assert.deepEqual(s.missing, []);
        assert.ok(s.nutrients.kcal > 50);
      });
      it("el motor encuentra porción para los dos perfiles tipo", () => {
        for (const [goal, daily] of [["fat_loss", A], ["muscle_gain", B]] as const) {
          const p = solvePortions({ participantId: goal, recipe: v, ingredients: ings, target: { mode: "macros", budget: scale(daily, SHARE[r.category]!) }, goal });
          assert.ok(["within_tolerance", "with_deviation"].includes(p.status), `${goal}: ${p.status}`);
          if (p.status === "with_deviation") assert.ok(p.binding.length > 0, "todo desvío viene explicado");
        }
      });
      it("funciona en modo pauta por porciones de intercambio", () => {
        const p = solvePortions({ participantId: "x", recipe: v, ingredients: ings, target: { mode: "exchanges", portions: { cereales: 1, carnes_bajas_grasa: 1 } } });
        assert.notEqual(p.status, "missing_data");
      });
      it("tiene etiquetas calculadas coherentes", () => {
        const t = recipeTags(r);
        if (r.lines.some((l) => catalog.get(l.ingredient)!.def.category === "carnes")) assert.ok(!t.includes("vegetariana"));
        if (r.lines.some((l) => (catalog.get(l.ingredient)!.def.allergens ?? []).includes("gluten"))) assert.ok(!t.includes("sin gluten"));
      });
    });
  }
});
