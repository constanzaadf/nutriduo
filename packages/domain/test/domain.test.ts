import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addNutrients,
  convertState,
  nutrientsForGrams,
  roundForDisplay,
  roundToStep,
  toGrams,
  weakest,
  type Nutrients,
} from "@nutriduo/domain";

const n = (kcal: number, p: number, c: number, f: number, fib = 0, na: number | null = 0): Nutrients => ({
  kcal,
  protein_g: p,
  carbs_g: c,
  fat_g: f,
  fiber_g: fib,
  sodium_mg: na,
});

describe("nutrientes", () => {
  it("escala valores por 100 g a gramos reales", () => {
    const r = nutrientsForGrams(n(350, 12, 70, 2, 3, 10), 70);
    assert.equal(r.kcal, 245);
    assert.ok(Math.abs(r.protein_g - 8.4) < 1e-9);
  });

  it("el sodio desconocido contamina la suma en vez de tratarse como cero", () => {
    const r = addNutrients(n(100, 1, 1, 1, 0, 50), n(100, 1, 1, 1, 0, null));
    assert.equal(r.sodium_mg, null);
    assert.equal(r.kcal, 200);
  });

  it("redondeo de presentación no altera el orden de magnitud", () => {
    const r = roundForDisplay(n(1234, 7.4, 132.6, 41, 22.4, 1234));
    assert.deepEqual(r, n(1230, 7, 135, 40, 22, 1230));
  });
});

describe("unidades", () => {
  it("masa siempre se convierte y es exacta", () => {
    assert.deepEqual(toGrams({ amount: 1.2, unit: "kg" }, {}), { ok: true, grams: 1200, exact: true });
  });

  it("volumen sin densidad es un error explícito", () => {
    assert.deepEqual(toGrams({ amount: 2, unit: "tbsp" }, {}), { ok: false, reason: "missing_density" });
  });

  it("volumen con densidad usa medidas métricas de cocina", () => {
    const r = toGrams({ amount: 2, unit: "tbsp" }, { densityGPerMl: 0.92 });
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(Math.abs(r.grams - 27.6) < 1e-9);
  });

  it("unidades sin peso unitario es un error explícito", () => {
    assert.deepEqual(toGrams({ amount: 3, unit: "unit" }, {}), { ok: false, reason: "missing_unit_weight" });
  });

  it("crudo ↔ cocido requiere factor y es invertible", () => {
    assert.equal(convertState(100, "raw", "cooked", 2.5), 250);
    assert.equal(convertState(250, "cooked", "raw", 2.5), 100);
    assert.equal(convertState(100, "raw", "cooked", undefined), null);
    assert.equal(convertState(100, "as_sold", "raw", undefined), 100);
  });

  it("redondeo de cocina nunca devuelve negativos", () => {
    assert.equal(roundToStep(-3, 5), 0);
    assert.equal(roundToStep(72, 5), 70);
    assert.equal(roundToStep(73, 5), 75);
  });
});

describe("confianza", () => {
  it("la cifra derivada hereda la confianza más débil", () => {
    assert.equal(weakest("prescribed", "calculated"), "calculated");
    assert.equal(weakest("calculated", "estimated", "prescribed"), "estimated");
  });
});
