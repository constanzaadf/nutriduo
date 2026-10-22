import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ModelBuilder, solveLp, solveMilp, type LinearProblem } from "../src/lp";

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a}`);

/** PRNG determinista (mulberry32) para pruebas reproducibles. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simplex", () => {
  it("resuelve el ejemplo clásico de producción", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x", 0, 4, { cost: -3 });
    const y = m.addVar("y", 0, Infinity, { cost: -5 });
    m.addConstraint([[y, 2]], "<=", 12);
    m.addConstraint([[x, 3], [y, 2]], "<=", 18);
    const r = solveLp(m.build());
    assert.equal(r.status, "optimal");
    close(r.x[0]!, 2);
    close(r.x[1]!, 6);
    close(r.objective, -36);
  });

  it("maneja restricciones ≥ con fase 1", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x", 0, Infinity, { cost: 1 });
    const y = m.addVar("y", 0, Infinity, { cost: 1 });
    m.addConstraint([[x, 1], [y, 2]], ">=", 4);
    m.addConstraint([[x, 3], [y, 1]], ">=", 6);
    const r = solveLp(m.build());
    close(r.x[0]!, 1.6);
    close(r.x[1]!, 1.2);
    close(r.objective, 2.8);
  });

  it("maneja igualdades y límites inferiores distintos de cero", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x", 3, 10, { cost: 1 });
    const y = m.addVar("y", 1, 10, { cost: 2 });
    m.addConstraint([[x, 1], [y, 1]], "=", 8);
    const r = solveLp(m.build());
    close(r.x[0]!, 7);
    close(r.x[1]!, 1);
  });

  it("detecta infactibilidad", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x");
    const y = m.addVar("y");
    m.addConstraint([[x, 1], [y, 1]], "<=", 1);
    m.addConstraint([[x, 1], [y, 1]], ">=", 2);
    assert.equal(solveLp(m.build()).status, "infeasible");
  });

  it("detecta no acotado", () => {
    const m = new ModelBuilder();
    m.addVar("x", 0, Infinity, { cost: -1 });
    assert.equal(solveLp(m.build()).status, "unbounded");
  });

  it("tolera filas redundantes", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x", 0, Infinity, { cost: 1 });
    const y = m.addVar("y", 0, Infinity, { cost: 1 });
    m.addConstraint([[x, 1], [y, 1]], "=", 5);
    m.addConstraint([[x, 2], [y, 2]], "=", 10);
    const r = solveLp(m.build());
    assert.equal(r.status, "optimal");
    close(r.objective, 5);
  });

  it("propiedad: ninguna muestra factible aleatoria mejora la solución", () => {
    const rand = rng(42);
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(rand() * 3);
      const p: LinearProblem = {
        nVars: n,
        objective: Array.from({ length: n }, () => rand() * 4 - 2),
        lower: Array.from({ length: n }, () => 0),
        upper: Array.from({ length: n }, () => 1 + rand() * 9),
        constraints: Array.from({ length: 2 }, () => ({
          coeffs: new Map(Array.from({ length: n }, (_, j) => [j, rand() * 3] as [number, number])),
          op: "<=" as const,
          rhs: 5 + rand() * 10,
        })),
      };
      const r = solveLp(p);
      assert.equal(r.status, "optimal");
      const feasible = (x: number[]) =>
        x.every((v, j) => v >= p.lower[j]! - 1e-7 && v <= p.upper[j]! + 1e-7) &&
        p.constraints.every((c) => {
          let s = 0;
          for (const [j, a] of c.coeffs) s += a * x[j]!;
          return s <= c.rhs + 1e-7;
        });
      assert.ok(feasible(r.x), "la solución respeta todas las restricciones");
      for (let k = 0; k < 300; k++) {
        const pt = Array.from({ length: n }, (_, j) => rand() * p.upper[j]!);
        if (!feasible(pt)) continue;
        const val = pt.reduce((a, v, j) => a + v * p.objective[j]!, 0);
        assert.ok(r.objective <= val + 1e-7, `muestra mejor que el óptimo en prueba ${trial}`);
      }
    }
  });
});

describe("branch-and-bound", () => {
  it("encuentra el óptimo entero, no el redondeo del continuo", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x", 0, Infinity, { cost: -5, integer: true });
    const y = m.addVar("y", 0, Infinity, { cost: -4, integer: true });
    m.addConstraint([[x, 6], [y, 4]], "<=", 24);
    m.addConstraint([[x, 1], [y, 2]], "<=", 6);
    const r = solveMilp(m.build());
    assert.equal(r.status, "optimal");
    assert.deepEqual(r.x, [4, 0]);
    close(r.objective, -20);
  });

  it("propiedad: coincide con búsqueda exhaustiva en 200 problemas aleatorios", () => {
    const rand = rng(7);
    for (let trial = 0; trial < 200; trial++) {
      const n = 3;
      const ub = 6;
      const obj = Array.from({ length: n }, () => Math.round((rand() * 10 - 5) * 10) / 10);
      const cons = Array.from({ length: 2 }, () => ({
        a: Array.from({ length: n }, () => Math.round(rand() * 50) / 10),
        rhs: Math.round((5 + rand() * 15) * 10) / 10,
      }));
      const p: LinearProblem = {
        nVars: n,
        objective: obj,
        lower: [0, 0, 0],
        upper: [ub, ub, ub],
        integer: [true, true, true],
        constraints: cons.map((c) => ({
          coeffs: new Map(c.a.map((v, j) => [j, v] as [number, number])),
          op: "<=" as const,
          rhs: c.rhs,
        })),
      };
      let bestVal = Infinity;
      for (let a = 0; a <= ub; a++)
        for (let b = 0; b <= ub; b++)
          for (let c = 0; c <= ub; c++) {
            const x = [a, b, c];
            if (!cons.every((k) => k.a.reduce((s, v, j) => s + v * x[j]!, 0) <= k.rhs + 1e-9)) continue;
            bestVal = Math.min(bestVal, x.reduce((s, v, j) => s + v * obj[j]!, 0));
          }
      const r = solveMilp(p);
      assert.equal(r.status, "optimal");
      close(r.objective, bestVal, 1e-6);
      assert.ok(r.x.every((v) => Number.isInteger(v)));
    }
  });

  it("es determinista", () => {
    const m = new ModelBuilder();
    const x = m.addVar("x", 0, 10, { cost: -1, integer: true });
    const y = m.addVar("y", 0, 10, { cost: -1, integer: true });
    m.addConstraint([[x, 2], [y, 2]], "<=", 9);
    const a = solveMilp(m.build());
    const b = solveMilp(m.build());
    assert.deepEqual(a, b);
  });
});
