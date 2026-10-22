/**
 * Parámetros por defecto del motor de metas. Son valores de partida
 * editables por perfil, no constantes clínicas: el objetivo es que nada
 * quede escondido en el código.
 */

export type GoalType =
  | "fat_loss"
  | "recomposition"
  | "muscle_gain"
  | "maintenance"
  | "balanced"
  | "custom";

export type DailyActivity = "sedentary" | "office_walking" | "standing" | "physical";

/** PAL de la vida cotidiana, SIN entrenamiento (el ejercicio se suma aparte por MET). */
export const DAILY_PAL: Record<DailyActivity, number> = {
  sedentary: 1.2,
  office_walking: 1.3,
  standing: 1.4,
  physical: 1.55,
};

export interface GoalRule {
  /** Ajuste por defecto sobre el TDEE, en fracción (−0,15 = −15 %). */
  kcalAdjust: number;
  kcalAdjustMin: number;
  kcalAdjustMax: number;
  proteinGPerKg: number;
  proteinGPerKgMin: number;
  proteinGPerKgMax: number;
}

export const GOAL_RULES: Record<GoalType, GoalRule> = {
  fat_loss: { kcalAdjust: -0.15, kcalAdjustMin: -0.25, kcalAdjustMax: -0.1, proteinGPerKg: 2.0, proteinGPerKgMin: 1.8, proteinGPerKgMax: 2.2 },
  recomposition: { kcalAdjust: -0.05, kcalAdjustMin: -0.1, kcalAdjustMax: 0, proteinGPerKg: 2.0, proteinGPerKgMin: 1.8, proteinGPerKgMax: 2.2 },
  muscle_gain: { kcalAdjust: 0.07, kcalAdjustMin: 0.05, kcalAdjustMax: 0.12, proteinGPerKg: 1.8, proteinGPerKgMin: 1.6, proteinGPerKgMax: 2.2 },
  maintenance: { kcalAdjust: 0, kcalAdjustMin: -0.05, kcalAdjustMax: 0.05, proteinGPerKg: 1.6, proteinGPerKgMin: 1.4, proteinGPerKgMax: 1.8 },
  balanced: { kcalAdjust: 0, kcalAdjustMin: -0.05, kcalAdjustMax: 0.05, proteinGPerKg: 1.4, proteinGPerKgMin: 1.2, proteinGPerKgMax: 1.8 },
  custom: { kcalAdjust: 0, kcalAdjustMin: -0.25, kcalAdjustMax: 0.12, proteinGPerKg: 1.6, proteinGPerKgMin: 1.2, proteinGPerKgMax: 2.2 },
};

export interface EngineParams {
  goalRules: Record<GoalType, GoalRule>;
  dailyPal: Record<DailyActivity, number>;
  /** Fracción de kcal desde grasa. */
  fatShare: number;
  fatShareMin: number;
  fatShareMax: number;
  /** Piso de grasa en g/kg de peso actual. */
  fatFloorGPerKg: number;
  /** Fibra orientativa por cada 1.000 kcal. */
  fiberGPer1000Kcal: number;
  /** Pérdida máxima proyectada por semana, como fracción del peso. */
  maxWeeklyLossShare: number;
  /** Aproximación de energía por kg de tejido perdido (uso solo para el tope de ritmo). */
  kcalPerKgTissue: number;
  /** IMC desde el cual la proteína se calcula sobre un peso de referencia. */
  proteinReferenceBmiThreshold: number;
  /** IMC usado para construir ese peso de referencia. */
  proteinReferenceBmi: number;
  /** Proteína por kg de masa libre de grasa, cuando se elige esa base. */
  proteinGPerKgLeanMass: number;
  /** Carbohidratos mínimos (g/kg) bajo los cuales se avisa si hay entrenamiento de fuerza. */
  lowCarbWarningGPerKg: number;
  /** Diferencia relativa sobre la cual una meta prescrita se marca como distinta de la estimación. */
  prescribedDivergenceShare: number;
}

export const DEFAULT_PARAMS: EngineParams = {
  goalRules: GOAL_RULES,
  dailyPal: DAILY_PAL,
  fatShare: 0.28,
  fatShareMin: 0.25,
  fatShareMax: 0.35,
  fatFloorGPerKg: 0.6,
  fiberGPer1000Kcal: 14,
  maxWeeklyLossShare: 0.01,
  kcalPerKgTissue: 7700,
  proteinReferenceBmiThreshold: 30,
  proteinReferenceBmi: 25,
  proteinGPerKgLeanMass: 2.4,
  lowCarbWarningGPerKg: 2,
  prescribedDivergenceShare: 0.2,
};

export const ENGINE_VERSION = "1.0.0";
