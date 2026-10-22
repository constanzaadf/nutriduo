import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ageInYears,
  computeGoals,
  macrosFromExchanges,
  slotBudget,
  DEFAULT_SLOT_SHARES,
  type ComputeGoalsInput,
  type ComputeGoalsResult,
  type ProfileInput,
} from "@nutriduo/nutrition-engine";

const close = (actual: number, expected: number, tol = 0.01, label = "") =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} esperado ${expected}, obtenido ${actual}`);

function ok(r: ReturnType<typeof computeGoals>): ComputeGoalsResult {
  assert.equal(r.ok, true, `se esperaba resultado, hubo rechazo: ${JSON.stringify(r.warnings)}`);
  return r as ComputeGoalsResult;
}

const runner: ProfileInput = {
  birthDate: "1992-03-15",
  equationConstant: "female",
  heightCm: 165,
  weightKg: 62,
  dailyActivity: "office_walking",
  training: [
    { label: "Trote", met: 8.3, minutes: 45, daysOfWeek: [1, 3, 5] },
    { label: "Fuerza", met: 3.5, minutes: 50, daysOfWeek: [2, 4], resistance: true },
  ],
  goal: "fat_loss",
};

describe("edad", () => {
  it("cuenta años cumplidos según la fecha de cálculo", () => {
    assert.equal(ageInYears("1992-03-15", "2026-10-22"), 34);
    assert.equal(ageInYears("1992-10-23", "2026-10-22"), 33);
    assert.equal(ageInYears("1992-10-22", "2026-10-22"), 34);
  });
});

describe("caso de referencia calculado a mano: pérdida de grasa con trote y fuerza", () => {
  const r = ok(computeGoals({ profile: runner, asOf: "2026-10-22" }));

  it("BMR Mifflin = 10·62 + 6,25·165 − 5·34 − 161", () => close(r.bmr, 1320.25));
  it("ejercicio neto semanal = 3·(7,3·62·0,75) + 2·(2,5·62·50/60)", () => close(r.exerciseKcalPerWeek, 1276.683, 0.01));
  it("TDEE = BMR·1,3 + ejercicio/7 (sin doble conteo)", () => close(r.tdee, 1898.708, 0.01));
  it("meta = TDEE·0,85", () => close(r.target.kcal, 1613.902, 0.01));
  it("proteína = 2,0 g/kg × 62", () => close(r.target.protein_g, 124));
  it("grasa = 28 % de kcal", () => close(r.target.fat_g, 50.210, 0.01));
  it("carbohidratos = remanente", () => close(r.target.carbs_g, 166.502, 0.01));
  it("fibra = 14 g por 1.000 kcal", () => close(r.target.fiber_g, 22.595, 0.01));
  it("los macros cierran con la energía (4/4/9)", () =>
    close(r.target.protein_g * 4 + r.target.carbs_g * 4 + r.target.fat_g * 9, r.target.kcal, 1e-6));
  it("sin advertencias en un caso normal", () => assert.deepEqual(r.warnings, []));
  it("rotulado como calculado", () => {
    assert.equal(r.source, "calculated");
    assert.equal(r.confidence, "calculated");
  });
});

describe("caso de referencia: ganancia muscular sedentaria", () => {
  const r = ok(
    computeGoals({
      profile: {
        birthDate: "1990-01-10",
        equationConstant: "male",
        heightCm: 180,
        weightKg: 85,
        dailyActivity: "sedentary",
        training: [],
        goal: "muscle_gain",
      },
      asOf: "2026-10-22",
    }),
  );
  it("BMR = 1800", () => close(r.bmr, 1800));
  it("TDEE = 2160", () => close(r.tdee, 2160));
  it("meta = 2160 · 1,07", () => close(r.target.kcal, 2311.2));
  it("proteína = 1,8 × 85", () => close(r.target.protein_g, 153));
  it("carbohidratos = remanente", () => close(r.target.carbs_g, 263.016, 0.01));
});

describe("pisos y topes de seguridad", () => {
  it("el déficit se recorta para no superar 1 % del peso por semana", () => {
    const r = ok(
      computeGoals({
        profile: {
          birthDate: "1996-01-01",
          equationConstant: "female",
          heightCm: 160,
          weightKg: 50,
          dailyActivity: "physical",
          training: [{ label: "Bici", met: 8, minutes: 90, daysOfWeek: [0, 1, 2, 3, 4, 5] }],
          goal: "fat_loss",
        },
        overrides: { kcalAdjust: -0.25 },
        asOf: "2026-10-22",
      }),
    );
    close(r.tdee, 2292.95, 0.01);
    close(r.tdee - r.target.kcal, 550, 1e-6, "déficit");
    assert.ok(r.warnings.some((w) => w.code === "rate_capped"));
  });

  it("la meta nunca baja del basal", () => {
    const r = ok(
      computeGoals({
        profile: {
          birthDate: "1986-01-01",
          equationConstant: "female",
          heightCm: 160,
          weightKg: 60,
          dailyActivity: "sedentary",
          training: [],
          goal: "fat_loss",
        },
        overrides: { kcalAdjust: -0.25 },
        asOf: "2026-10-22",
      }),
    );
    close(r.bmr, 1239);
    close(r.target.kcal, 1239);
    assert.ok(r.warnings.some((w) => w.code === "floor_bmr_applied"));
  });

  it("un ajuste fuera de rango se acota y se avisa", () => {
    const r = ok(computeGoals({ profile: runner, overrides: { kcalAdjust: -0.4 }, asOf: "2026-10-22" }));
    assert.ok(r.warnings.some((w) => w.code === "adjust_clamped_to_range"));
    assert.ok(r.appliedAdjust >= -0.25 - 1e-12);
  });

  it("menores de 18 no reciben cálculo automático", () => {
    const r = computeGoals({ profile: { ...runner, birthDate: "2010-01-01" }, asOf: "2026-10-22" });
    assert.equal(r.ok, false);
    assert.equal(r.warnings[0]?.code, "minor_not_supported");
  });

  it("con embarazo o lactancia no hay déficit automático", () => {
    const r = ok(computeGoals({ profile: { ...runner, clinicalFlags: ["lactation"] }, asOf: "2026-10-22" }));
    assert.equal(r.appliedAdjust, 0);
    close(r.target.kcal, r.tdee, 1e-9);
    assert.ok(r.warnings.some((w) => w.code === "clinical_flag_requires_professional"));
  });

  it("con IMC ≥ 30 la proteína usa el peso correspondiente a IMC 25", () => {
    const r = ok(
      computeGoals({
        profile: { ...runner, heightCm: 170, weightKg: 110, training: [] },
        asOf: "2026-10-22",
      }),
    );
    close(r.referenceWeightKg, 72.25);
    close(r.target.protein_g, 144.5);
  });

  it("Katch-McArdle sin % de grasa vuelve a Mifflin con aviso", () => {
    const r = ok(computeGoals({ profile: runner, overrides: { bmrMethod: "katch_mcardle" }, asOf: "2026-10-22" }));
    assert.equal(r.bmrMethod, "mifflin_st_jeor");
    assert.ok(r.warnings.some((w) => w.code === "katch_requires_body_fat"));
  });

  it("Katch-McArdle con % de grasa = 370 + 21,6 · MLG", () => {
    const r = ok(
      computeGoals({
        profile: { ...runner, bodyFatPct: 25 },
        overrides: { bmrMethod: "katch_mcardle" },
        asOf: "2026-10-22",
      }),
    );
    close(r.bmr, 370 + 21.6 * 46.5);
  });

  it("la constante promedio queda rotulada como estimación", () => {
    const r = ok(computeGoals({ profile: { ...runner, equationConstant: "average" }, asOf: "2026-10-22" }));
    assert.equal(r.confidence, "estimated");
    close(r.bmr, 1320.25 + 161 - 78);
  });
});

describe("metas prescritas", () => {
  it("una meta profesional manda sobre el cálculo y la estimación queda de referencia", () => {
    const r = ok(
      computeGoals({
        profile: runner,
        asOf: "2026-10-22",
        prescribed: { by: "professional", kcal: 1500, protein_g: 110, fat_g: 50 },
      }),
    );
    assert.equal(r.source, "prescribed");
    assert.equal(r.confidence, "prescribed");
    assert.equal(r.target.kcal, 1500);
    close(r.target.carbs_g, (1500 - 440 - 450) / 4);
    close(r.estimate.kcal, 1613.902, 0.01);
  });

  it("avisa si la meta indicada difiere mucho de la estimación, sin cambiarla", () => {
    const r = ok(computeGoals({ profile: runner, asOf: "2026-10-22", prescribed: { by: "professional", kcal: 1200 } }));
    assert.equal(r.target.kcal, 1200);
    assert.ok(r.warnings.some((w) => w.code === "prescribed_differs_from_estimate"));
  });

  it("una meta manual bajo el basal se guarda con advertencia", () => {
    const r = ok(computeGoals({ profile: runner, asOf: "2026-10-22", prescribed: { by: "self", kcal: 1100 } }));
    assert.equal(r.source, "manual");
    assert.ok(r.warnings.some((w) => w.code === "manual_below_bmr"));
  });
});

describe("metas por día de la semana", () => {
  it("días de entrenamiento suben kcal y el promedio coincide con la meta semanal", () => {
    const r = ok(computeGoals({ profile: runner, asOf: "2026-10-22", overrides: { dayMode: "by_weekday" } }));
    assert.ok(r.byWeekday);
    const days = r.byWeekday!;
    assert.ok(days[1]!.kcal > days[0]!.kcal, "lunes (trote) > domingo (descanso)");
    const avg = days.reduce((a, d) => a + d.kcal, 0) / 7;
    close(avg, r.target.kcal, 1e-6);
    for (const d of days) close(d.protein_g, r.target.protein_g, 1e-9, "proteína constante");
  });
});

describe("pureza (criterio 1: los objetivos de un perfil no afectan al otro)", () => {
  it("misma entrada → misma salida, sin importar qué se calculó entre medio", () => {
    const input: ComputeGoalsInput = { profile: runner, asOf: "2026-10-22" };
    const snapshot = JSON.stringify(input);
    const a1 = computeGoals(input);
    computeGoals({ profile: { ...runner, weightKg: 95, goal: "muscle_gain" }, asOf: "2026-10-22" });
    const a2 = computeGoals(input);
    assert.deepEqual(a1, a2);
    assert.equal(JSON.stringify(input), snapshot, "la entrada no se muta");
  });
});

describe("intercambios", () => {
  it("convierte porciones a macros con la tabla", () => {
    const m = macrosFromExchanges({ cereales: 2, carnes_bajas_grasa: 1.5, verduras_general: 1 });
    close(m.kcal, 407.5);
    close(m.protein_g, 24.5);
    close(m.carbs_g, 66.5);
    close(m.fat_g, 5);
  });
  it("rechaza porciones negativas", () => {
    assert.throws(() => macrosFromExchanges({ frutas: -1 }));
  });
});

describe("presupuesto por tiempo de comida", () => {
  const daily = { kcal: 2000, protein_g: 120, carbs_g: 220, fat_g: 70, fiber_g: 28 };

  it("sin comidas aprobadas, el presupuesto es la fracción configurada", () => {
    const { budget } = slotBudget(daily, DEFAULT_SLOT_SHARES, "dinner", []);
    close(budget.kcal, 500);
  });

  it("la diferencia de un slot aprobado se reparte entre los abiertos del día", () => {
    const { budget } = slotBudget(daily, DEFAULT_SLOT_SHARES, "dinner", [
      { slot: "lunch", planned: { kcal: 500, protein_g: 36, carbs_g: 66, fat_g: 21, fiber_g: 8.4 } },
    ]);
    close(budget.kcal, 500 + 100 * (0.25 / 0.7), 1e-6);
  });

  it("la redistribución tiene tope de ±15 %", () => {
    const { budget } = slotBudget(daily, DEFAULT_SLOT_SHARES, "dinner", [
      { slot: "lunch", planned: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
    ]);
    close(budget.kcal, 575);
  });

  it("los porcentajes deben sumar 100 %", () => {
    assert.throws(() => slotBudget(daily, { lunch: 0.5, dinner: 0.4 }, "lunch", []));
  });
});
