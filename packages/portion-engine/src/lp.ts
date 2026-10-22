/**
 * Solver de programación lineal entera-mixta, sin dependencias.
 *
 * - LP: simplex de dos fases sobre tableau denso con regla de Bland
 *   (determinista y sin ciclos). Los problemas de porciones tienen del orden
 *   de decenas de variables, así que un tableau denso es más que suficiente.
 * - MILP: branch-and-bound en profundidad, ramificando en la variable más
 *   fraccionaria (empate → menor índice), con límite de nodos.
 *
 * Misma entrada → misma salida, bit a bit: no hay aleatoriedad ni dependencia
 * del entorno (a diferencia de un solver WASM externo).
 */

export type ConstraintOp = "<=" | ">=" | "=";

export interface LinearConstraint {
  /** Coeficientes dispersos: índice de variable → coeficiente. */
  coeffs: ReadonlyMap<number, number>;
  op: ConstraintOp;
  rhs: number;
  /** Etiqueta para explicar restricciones activas. */
  label?: string;
}

export interface LinearProblem {
  nVars: number;
  /** Minimizar c·x. */
  objective: readonly number[];
  constraints: readonly LinearConstraint[];
  lower: readonly number[];
  upper: readonly number[]; // Infinity permitido
  integer?: readonly boolean[];
}

export type LpStatus = "optimal" | "infeasible" | "unbounded" | "node_limit";

export interface LpSolution {
  status: LpStatus;
  x: number[];
  objective: number;
  /** Nodos explorados en branch-and-bound (1 para LP puro). */
  nodes: number;
}

const EPS = 1e-9;
const INT_EPS = 1e-6;

/* ─────────────────────── Simplex de dos fases ─────────────────────── */

interface Tableau {
  m: number; // filas de restricción
  n: number; // columnas (sin RHS)
  t: Float64Array[]; // m filas + 1 fila objetivo; cada fila n+1 (último = RHS)
  basis: number[];
}

function pivot(tab: Tableau, row: number, col: number): void {
  const { t, n } = tab;
  const pr = t[row]!;
  const pv = pr[col]!;
  for (let j = 0; j <= n; j++) pr[j]! /= pv;
  pr[col] = 1;
  for (let i = 0; i < t.length; i++) {
    if (i === row) continue;
    const ri = t[i]!;
    const f = ri[col]!;
    if (Math.abs(f) < 1e-15) continue;
    for (let j = 0; j <= n; j++) ri[j]! -= f * pr[j]!;
    ri[col] = 0;
  }
  tab.basis[row] = col;
}

/** Itera simplex sobre la fila objetivo (última fila). Columnas permitidas: allowed[j]. */
function runSimplex(tab: Tableau, allowed: boolean[], maxIter = 50_000): "optimal" | "unbounded" {
  const { m, n, t } = tab;
  const obj = t[m]!;
  for (let iter = 0; iter < maxIter; iter++) {
    // Bland: primera columna con costo reducido negativo
    let col = -1;
    for (let j = 0; j < n; j++) {
      if (allowed[j] && obj[j]! < -EPS) {
        col = j;
        break;
      }
    }
    if (col < 0) return "optimal";
    // Razón mínima; empate → menor índice de variable básica (Bland)
    let row = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      const a = t[i]![col]!;
      if (a > EPS) {
        const ratio = t[i]![n]! / a;
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && row >= 0 && tab.basis[i]! < tab.basis[row]!)) {
          best = ratio;
          row = i;
        }
      }
    }
    if (row < 0) return "unbounded";
    pivot(tab, row, col);
  }
  throw new Error("Simplex: se alcanzó el máximo de iteraciones");
}

/** Resuelve un LP continuo (ignora `integer`). */
export function solveLp(p: LinearProblem): LpSolution {
  const { nVars } = p;
  // 1. Desplazamiento x = l + x', x' ≥ 0
  for (let j = 0; j < nVars; j++) {
    const l = p.lower[j]!;
    const u = p.upper[j]!;
    if (!Number.isFinite(l)) throw new Error(`Variable ${j}: el límite inferior debe ser finito`);
    if (u < l - EPS) return { status: "infeasible", x: [], objective: NaN, nodes: 1 };
  }

  type Row = { a: Float64Array; op: ConstraintOp; rhs: number };
  const rows: Row[] = [];
  for (const c of p.constraints) {
    const a = new Float64Array(nVars);
    let shift = 0;
    for (const [j, v] of c.coeffs) {
      a[j] = v;
      shift += v * p.lower[j]!;
    }
    rows.push({ a, op: c.op, rhs: c.rhs - shift });
  }
  for (let j = 0; j < nVars; j++) {
    const u = p.upper[j]!;
    if (Number.isFinite(u)) {
      const a = new Float64Array(nVars);
      a[j] = 1;
      rows.push({ a, op: "<=", rhs: u - p.lower[j]! });
    }
  }
  // 2. RHS ≥ 0
  for (const r of rows) {
    if (r.rhs < 0) {
      for (let j = 0; j < nVars; j++) r.a[j] = -r.a[j]!;
      r.rhs = -r.rhs;
      r.op = r.op === "<=" ? ">=" : r.op === ">=" ? "<=" : "=";
    }
  }
  // 3. Columnas: x' | holguras/excedentes | artificiales
  const m = rows.length;
  const nSlack = rows.filter((r) => r.op !== "=").length;
  const nArt = rows.filter((r) => r.op !== "<=").length;
  const n = nVars + nSlack + nArt;
  const t: Float64Array[] = [];
  const basis: number[] = [];
  let sIdx = nVars;
  let aIdx = nVars + nSlack;
  const isArt = new Array<boolean>(n).fill(false);
  for (const r of rows) {
    const row = new Float64Array(n + 1);
    row.set(r.a, 0);
    row[n] = r.rhs;
    if (r.op === "<=") {
      row[sIdx] = 1;
      basis.push(sIdx++);
    } else if (r.op === ">=") {
      row[sIdx++] = -1;
      row[aIdx] = 1;
      isArt[aIdx] = true;
      basis.push(aIdx++);
    } else {
      row[aIdx] = 1;
      isArt[aIdx] = true;
      basis.push(aIdx++);
    }
    t.push(row);
  }
  const tab: Tableau = { m, n, t, basis };

  // Fase 1: minimizar suma de artificiales
  if (nArt > 0) {
    const obj = new Float64Array(n + 1);
    for (let j = 0; j < n; j++) if (isArt[j]) obj[j] = 1;
    // Volver la fila objetivo canónica respecto a la base
    for (let i = 0; i < m; i++) {
      if (isArt[basis[i]!]) {
        const ri = t[i]!;
        for (let j = 0; j <= n; j++) obj[j]! -= ri[j]!;
      }
    }
    t.push(obj);
    const allowed = new Array<boolean>(n).fill(true);
    runSimplex(tab, allowed);
    const phase1 = -t[m]![n]!;
    if (phase1 > 1e-7) return { status: "infeasible", x: [], objective: NaN, nodes: 1 };
    // Sacar artificiales que quedaron en la base con valor 0
    for (let i = 0; i < m; i++) {
      if (isArt[basis[i]!]) {
        let col = -1;
        for (let j = 0; j < n; j++) {
          if (!isArt[j] && Math.abs(t[i]![j]!) > 1e-9) {
            col = j;
            break;
          }
        }
        if (col >= 0) pivot(tab, i, col);
        // si no hay columna, la fila es redundante: la artificial queda en 0 y no se puede mover
      }
    }
    t.pop();
  }

  // Fase 2
  const obj = new Float64Array(n + 1);
  for (let j = 0; j < nVars; j++) obj[j] = p.objective[j] ?? 0;
  for (let i = 0; i < m; i++) {
    const cb = obj[basis[i]!]!;
    if (cb !== 0) {
      const ri = t[i]!;
      for (let j = 0; j <= n; j++) obj[j]! -= cb * ri[j]!;
    }
  }
  t.push(obj);
  const allowed = isArt.map((a) => !a);
  const status = runSimplex(tab, allowed);
  if (status === "unbounded") return { status, x: [], objective: -Infinity, nodes: 1 };

  const xPrime = new Array<number>(nVars).fill(0);
  for (let i = 0; i < m; i++) {
    const b = basis[i]!;
    if (b < nVars) xPrime[b] = t[i]![n]!;
  }
  const x = xPrime.map((v, j) => {
    const val = v + p.lower[j]!;
    // limpiar ruido numérico contra los límites
    if (Math.abs(val - p.lower[j]!) < 1e-9) return p.lower[j]!;
    if (Number.isFinite(p.upper[j]!) && Math.abs(val - p.upper[j]!) < 1e-9) return p.upper[j]!;
    return val;
  });
  const objective = x.reduce((acc, v, j) => acc + v * (p.objective[j] ?? 0), 0);
  return { status: "optimal", x, objective, nodes: 1 };
}

/* ─────────────────────── Branch-and-bound ─────────────────────── */

export function solveMilp(p: LinearProblem, maxNodes = 5000): LpSolution {
  const ints = p.integer ?? [];
  if (!ints.some(Boolean)) return solveLp(p);

  let best: LpSolution | null = null;
  let nodes = 0;
  const stack: { lower: number[]; upper: number[] }[] = [{ lower: [...p.lower], upper: [...p.upper] }];
  let hitLimit = false;

  while (stack.length > 0) {
    if (nodes >= maxNodes) {
      hitLimit = true;
      break;
    }
    const node = stack.pop()!;
    nodes++;
    const r = solveLp({ ...p, lower: node.lower, upper: node.upper });
    if (r.status !== "optimal") continue;
    if (best && r.objective >= best.objective - 1e-9) continue; // poda por cota

    // variable entera más fraccionaria (empate → menor índice)
    let jBranch = -1;
    let bestFrac = INT_EPS;
    for (let j = 0; j < p.nVars; j++) {
      if (!ints[j]) continue;
      const v = r.x[j]!;
      const frac = Math.abs(v - Math.round(v));
      if (frac > bestFrac + 1e-12) {
        bestFrac = frac;
        jBranch = j;
      }
    }
    if (jBranch < 0) {
      const x = r.x.map((v, j) => (ints[j] ? Math.round(v) : v));
      best = { status: "optimal", x, objective: r.objective, nodes };
      continue;
    }
    const v = r.x[jBranch]!;
    const down = { lower: [...node.lower], upper: [...node.upper] };
    down.upper[jBranch] = Math.floor(v);
    const up = { lower: [...node.lower], upper: [...node.upper] };
    up.lower[jBranch] = Math.ceil(v);
    // explorar primero la rama más cercana al valor (se apila al final)
    if (v - Math.floor(v) < 0.5) {
      stack.push(up, down);
    } else {
      stack.push(down, up);
    }
  }

  if (!best) {
    return { status: hitLimit ? "node_limit" : "infeasible", x: [], objective: NaN, nodes };
  }
  return { ...best, nodes, status: hitLimit ? "node_limit" : "optimal" };
}

/* ─────────────────────── Constructor ergonómico ─────────────────────── */

/** Pequeño constructor de modelos con variables nombradas. */
export class ModelBuilder {
  private names: string[] = [];
  private lo: number[] = [];
  private hi: number[] = [];
  private isInt: boolean[] = [];
  private obj: number[] = [];
  private cons: LinearConstraint[] = [];

  addVar(name: string, lower = 0, upper = Infinity, opts: { integer?: boolean; cost?: number } = {}): number {
    const idx = this.names.length;
    this.names.push(name);
    this.lo.push(lower);
    this.hi.push(upper);
    this.isInt.push(opts.integer ?? false);
    this.obj.push(opts.cost ?? 0);
    return idx;
  }

  addCost(v: number, c: number): void {
    this.obj[v] = (this.obj[v] ?? 0) + c;
  }

  addConstraint(terms: [number, number][], op: ConstraintOp, rhs: number, label?: string): void {
    const coeffs = new Map<number, number>();
    for (const [v, c] of terms) coeffs.set(v, (coeffs.get(v) ?? 0) + c);
    this.cons.push(label === undefined ? { coeffs, op, rhs } : { coeffs, op, rhs, label });
  }

  name(v: number): string {
    return this.names[v]!;
  }

  bounds(v: number): [number, number] {
    return [this.lo[v]!, this.hi[v]!];
  }

  build(): LinearProblem {
    return {
      nVars: this.names.length,
      objective: [...this.obj],
      constraints: [...this.cons],
      lower: [...this.lo],
      upper: [...this.hi],
      integer: [...this.isInt],
    };
  }
}
