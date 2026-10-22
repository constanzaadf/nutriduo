import type { Confidence } from "@nutriduo/domain";
import {
  DEFAULT_PARAMS,
  ENGINE_VERSION,
  type DailyActivity,
  type EngineParams,
  type GoalType,
} from "./params";

/* ───────────────────────────── Entradas ───────────────────────────── */

export type EquationConstant = "male" | "female" | "average";
export type BmrMethod = "mifflin_st_jeor" | "katch_mcardle";
export type ClinicalFlag = "pregnancy" | "lactation" | "medical_condition";

export interface TrainingSession {
  label: string;
  /** MET bruto de la actividad (p. ej. trote 8 km/h ≈ 8,3; pesas moderadas ≈ 3,5). */
  met: number;
  minutes: number;
  /** Días de la semana (0 = domingo … 6 = sábado). */
  daysOfWeek: number[];
  resistance?: boolean;
}

export interface ProfileInput {
  birthDate: string; // ISO YYYY-MM-DD
  equationConstant: EquationConstant;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number | null;
  dailyActivity: DailyActivity;
  /** Si se indica, reemplaza el PAL de la tabla. */
  dailyPalOverride?: number | null;
  training: TrainingSession[];
  goal: GoalType;
  targetWeightKg?: number | null;
  clinicalFlags?: ClinicalFlag[];
}

export interface GoalOverrides {
  kcalAdjust?: number;
  proteinGPerKg?: number;
  fatShare?: number;
  bmrMethod?: BmrMethod;
  proteinBasis?: "reference_weight" | "lean_mass";
  /** "weekly_average" (por defecto) o una meta por día de la semana. */
  dayMode?: "weekly_average" | "by_weekday";
}

export interface PrescribedGoal {
  by: "professional" | "self";
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
}

export interface ComputeGoalsInput {
  profile: ProfileInput;
  /** Fecha de cálculo, explícita para que el resultado sea reproducible. */
  asOf: string;
  overrides?: GoalOverrides;
  prescribed?: PrescribedGoal | null;
  params?: Partial<EngineParams>;
}

/* ───────────────────────────── Salidas ───────────────────────────── */

export interface MacroTarget {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export type GoalWarningCode =
  | "minor_not_supported"
  | "clinical_flag_requires_professional"
  | "average_constant_is_approximation"
  | "katch_requires_body_fat"
  | "adjust_clamped_to_range"
  | "rate_capped"
  | "floor_bmr_applied"
  | "manual_below_bmr"
  | "fat_floor_applied"
  | "protein_fat_exceed_energy"
  | "low_carbs_for_training"
  | "prescribed_differs_from_estimate"
  | "protein_clamped_to_range";

export interface GoalWarning {
  code: GoalWarningCode;
  message: string;
}

export interface ComputeGoalsResult {
  ok: true;
  engineVersion: string;
  ageYears: number;
  bmr: number;
  bmrMethod: BmrMethod;
  dailyPal: number;
  exerciseKcalPerWeek: number;
  tdee: number;
  appliedAdjust: number;
  referenceWeightKg: number;
  /** Meta vigente: prescrita si existe, si no la calculada. */
  target: MacroTarget;
  /** Siempre presente: la estimación del motor, para mostrar al lado de una prescrita. */
  estimate: MacroTarget;
  byWeekday: MacroTarget[] | null;
  source: "prescribed" | "manual" | "calculated";
  confidence: Confidence;
  warnings: GoalWarning[];
  trace: {
    input: ComputeGoalsInput;
    params: EngineParams;
  };
}

export interface ComputeGoalsRefusal {
  ok: false;
  engineVersion: string;
  warnings: GoalWarning[];
}

/* ───────────────────────────── Cálculo ───────────────────────────── */

export function ageInYears(birthDate: string, asOf: string): number {
  const b = parseIsoDate(birthDate);
  const a = parseIsoDate(asOf);
  let age = a.y - b.y;
  if (a.m < b.m || (a.m === b.m && a.d < b.d)) age -= 1;
  return age;
}

function parseIsoDate(s: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new RangeError(`Fecha inválida: ${s} (se espera YYYY-MM-DD)`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function mifflinStJeor(weightKg: number, heightCm: number, ageYears: number, c: EquationConstant): number {
  const s = c === "male" ? 5 : c === "female" ? -161 : -78;
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + s;
}

export function katchMcArdle(weightKg: number, bodyFatPct: number): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * lbm;
}

/** kcal netas de una sesión: (MET − 1) porque el reposo ya está en el basal × PAL. */
export function sessionNetKcal(s: TrainingSession, weightKg: number): number {
  return Math.max(0, s.met - 1) * weightKg * (s.minutes / 60);
}

function validateProfile(p: ProfileInput): void {
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new RangeError(msg);
  };
  check(p.heightCm >= 120 && p.heightCm <= 230, "Estatura fuera de rango (120–230 cm)");
  check(p.weightKg >= 30 && p.weightKg <= 300, "Peso fuera de rango (30–300 kg)");
  if (p.bodyFatPct != null) check(p.bodyFatPct >= 3 && p.bodyFatPct <= 70, "% de grasa fuera de rango (3–70)");
  for (const s of p.training) {
    check(s.met >= 1 && s.met <= 20, `MET fuera de rango en "${s.label}"`);
    check(s.minutes > 0 && s.minutes <= 600, `Duración fuera de rango en "${s.label}"`);
    check(s.daysOfWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), `Días inválidos en "${s.label}"`);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeGoals(input: ComputeGoalsInput): ComputeGoalsResult | ComputeGoalsRefusal {
  const params: EngineParams = { ...DEFAULT_PARAMS, ...input.params };
  const p = input.profile;
  const o = input.overrides ?? {};
  const warnings: GoalWarning[] = [];
  const warn = (code: GoalWarningCode, message: string) => warnings.push({ code, message });

  validateProfile(p);
  const age = ageInYears(p.birthDate, input.asOf);
  if (age < 18) {
    warn("minor_not_supported", "El cálculo automático está disponible solo para mayores de 18 años. Usa una meta indicada por un profesional.");
    return { ok: false, engineVersion: ENGINE_VERSION, warnings };
  }

  /* 1. Basal */
  let bmrMethod: BmrMethod = o.bmrMethod ?? "mifflin_st_jeor";
  if (bmrMethod === "katch_mcardle" && p.bodyFatPct == null) {
    warn("katch_requires_body_fat", "Katch-McArdle necesita % de grasa; se usó Mifflin-St Jeor.");
    bmrMethod = "mifflin_st_jeor";
  }
  const bmr =
    bmrMethod === "katch_mcardle"
      ? katchMcArdle(p.weightKg, p.bodyFatPct as number)
      : mifflinStJeor(p.weightKg, p.heightCm, age, p.equationConstant);
  let confidence: Confidence = "calculated";
  if (bmrMethod === "mifflin_st_jeor" && p.equationConstant === "average") {
    warn("average_constant_is_approximation", "Se usó el promedio de ambas constantes de la ecuación; el resultado es aproximado.");
    confidence = "estimated";
  }

  /* 2. Gasto total sin doble conteo */
  const dailyPal = p.dailyPalOverride ?? params.dailyPal[p.dailyActivity];
  const kcalByWeekday = Array.from({ length: 7 }, () => 0);
  for (const s of p.training) {
    const k = sessionNetKcal(s, p.weightKg);
    for (const d of s.daysOfWeek) kcalByWeekday[d] = (kcalByWeekday[d] ?? 0) + k;
  }
  const exerciseKcalPerWeek = kcalByWeekday.reduce((a, b) => a + b, 0);
  const baseExpenditure = bmr * dailyPal;
  const tdee = baseExpenditure + exerciseKcalPerWeek / 7;

  /* 3. Ajuste por objetivo */
  const rule = params.goalRules[p.goal];
  const hasClinicalFlag = (p.clinicalFlags ?? []).length > 0;
  let adjust = o.kcalAdjust ?? rule.kcalAdjust;
  const clamped = clamp(adjust, rule.kcalAdjustMin, rule.kcalAdjustMax);
  if (clamped !== adjust) {
    warn("adjust_clamped_to_range", `El ajuste pedido (${pct(adjust)}) quedó en ${pct(clamped)}, el límite configurado para este objetivo.`);
    adjust = clamped;
  }
  if (hasClinicalFlag && adjust !== 0) {
    warn("clinical_flag_requires_professional", "Con embarazo, lactancia o una condición médica declarada no se aplica déficit ni superávit automático. Carga la meta de tu profesional.");
    adjust = 0;
  }

  // Tope de ritmo de pérdida: déficit diario ≤ peso × tope semanal × kcal/kg ÷ 7
  if (adjust < 0) {
    const maxDeficit = (p.weightKg * params.maxWeeklyLossShare * params.kcalPerKgTissue) / 7;
    const deficit = -adjust * tdee;
    if (deficit > maxDeficit) {
      adjust = -maxDeficit / tdee;
      warn("rate_capped", `El déficit se limitó a ${Math.round(maxDeficit)} kcal/día para no superar una pérdida proyectada de ${pct(params.maxWeeklyLossShare)} del peso por semana.`);
    }
  }

  /* 4. Peso de referencia para proteína */
  const hM = p.heightCm / 100;
  const bmi = p.weightKg / (hM * hM);
  const referenceWeightKg =
    bmi >= params.proteinReferenceBmiThreshold ? params.proteinReferenceBmi * hM * hM : p.weightKg;

  const buildTarget = (dayExerciseKcal: number | null): MacroTarget => {
    const dayTdee = dayExerciseKcal === null ? tdee : baseExpenditure + dayExerciseKcal;
    let kcal = dayTdee * (1 + adjust);
    if (kcal < bmr) {
      kcal = bmr;
      if (!warnings.some((w) => w.code === "floor_bmr_applied")) {
        warn("floor_bmr_applied", "La meta calórica no baja del gasto basal estimado.");
      }
    }
    // Proteína
    let proteinPerKg = o.proteinGPerKg ?? rule.proteinGPerKg;
    const pClamped = clamp(proteinPerKg, rule.proteinGPerKgMin, rule.proteinGPerKgMax);
    if (pClamped !== proteinPerKg && !warnings.some((w) => w.code === "protein_clamped_to_range")) {
      warn("protein_clamped_to_range", `La proteína pedida (${proteinPerKg} g/kg) quedó en ${pClamped} g/kg, el rango configurado.`);
    }
    proteinPerKg = pClamped;
    const protein =
      o.proteinBasis === "lean_mass" && p.bodyFatPct != null
        ? p.weightKg * (1 - p.bodyFatPct / 100) * params.proteinGPerKgLeanMass
        : referenceWeightKg * proteinPerKg;
    // Grasa
    const fatShare = clamp(o.fatShare ?? params.fatShare, params.fatShareMin, params.fatShareMax);
    const fatFloor = params.fatFloorGPerKg * p.weightKg;
    let fat = (kcal * fatShare) / 9;
    if (fat < fatFloor) {
      fat = fatFloor;
      if (!warnings.some((w) => w.code === "fat_floor_applied")) {
        warn("fat_floor_applied", `La grasa se llevó a su piso de ${params.fatFloorGPerKg} g/kg.`);
      }
    }
    // Carbohidratos = remanente
    let carbs = (kcal - protein * 4 - fat * 9) / 4;
    if (carbs < 0) {
      // Primero se recorta grasa hasta su piso; si no alcanza, carbohidratos en 0.
      fat = Math.max(fatFloor, (kcal - protein * 4) / 9);
      carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
      if (!warnings.some((w) => w.code === "protein_fat_exceed_energy")) {
        warn("protein_fat_exceed_energy", "Proteína y grasa mínimas superan la energía disponible; revisa los parámetros.");
      }
    }
    return {
      kcal,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      fiber_g: (kcal / 1000) * params.fiberGPer1000Kcal,
    };
  };

  const estimate = buildTarget(null);
  const byWeekday = o.dayMode === "by_weekday" ? kcalByWeekday.map((k) => buildTarget(k)) : null;

  const doesResistance = p.training.some((s) => s.resistance);
  if (doesResistance && estimate.carbs_g < params.lowCarbWarningGPerKg * p.weightKg) {
    warn("low_carbs_for_training", `Los carbohidratos quedan bajo ${params.lowCarbWarningGPerKg} g/kg con entrenamiento de fuerza.`);
  }

  /* 5. Meta prescrita o manual */
  const pr = input.prescribed;
  let target = estimate;
  let source: ComputeGoalsResult["source"] = "calculated";
  if (pr) {
    target = mergePrescribed(estimate, pr);
    source = pr.by === "professional" ? "prescribed" : "manual";
    confidence = pr.by === "professional" ? "prescribed" : confidence;
    if (pr.kcal != null) {
      const diff = Math.abs(pr.kcal - estimate.kcal) / estimate.kcal;
      if (diff > params.prescribedDivergenceShare) {
        warn("prescribed_differs_from_estimate", `La meta indicada difiere ${pct(diff)} de la estimación del motor. Se respeta la indicada; la estimación queda solo como referencia.`);
      }
      if (pr.by === "self" && pr.kcal < bmr) {
        warn("manual_below_bmr", "La meta manual está bajo el gasto basal estimado. Se guarda, pero conviene revisarla con un profesional.");
      }
    }
  }

  return {
    ok: true,
    engineVersion: ENGINE_VERSION,
    ageYears: age,
    bmr,
    bmrMethod,
    dailyPal,
    exerciseKcalPerWeek,
    tdee,
    appliedAdjust: adjust,
    referenceWeightKg,
    target,
    estimate,
    byWeekday: pr ? null : byWeekday,
    source,
    confidence,
    warnings,
    trace: { input, params },
  };
}

/** Combina una meta indicada (total o parcial) con la estimación, recalculando el remanente. */
function mergePrescribed(est: MacroTarget, pr: PrescribedGoal): MacroTarget {
  const kcal = pr.kcal ?? est.kcal;
  const protein = pr.protein_g ?? est.protein_g;
  const fat = pr.fat_g ?? (pr.kcal != null ? (est.fat_g / est.kcal) * kcal : est.fat_g);
  const carbs = pr.carbs_g ?? Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  const fiber = pr.fiber_g ?? (est.fiber_g / est.kcal) * kcal;
  return { kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, fiber_g: fiber };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0).replace(".", ",")} %`;
}
