import { describe, it, expect } from "vitest";
import { transformReturns, createReturnEngine } from "../returns";

// ── transformReturns — eMoney whitepaper p.10–11 worked example ────────────
//
// Given the Cholesky L, log-mean μ, and the standard-normal draw Z printed
// in the PDF, the final rate vector should match the PDF's printed output.
describe("transformReturns — eMoney whitepaper worked example", () => {
  const L = [
    [0.13584, 0, 0],
    [0.14748, 0.03025, 0],
    [0.13399, -0.02399, 0.00127],
  ];
  const mu = [0.10312, 0.08788, 0.08377];
  const Z = [0.14444, -0.43825, -1.35294];
  // PDF p.11 final rate vector: exp(X+μ) - 1
  const expected = [0.13059, 0.10067, 0.11843];

  it("produces the PDF's final rate vector (to 4 dp)", () => {
    const r = transformReturns(L, mu, Z);
    // 4 dp is the precision the PDF is self-consistent at; see lognormal.test.ts
    // for the rationale — same compounding-rounding issue applies here.
    expect(r[0]).toBeCloseTo(expected[0], 4);
    expect(r[1]).toBeCloseTo(expected[1], 4);
    expect(r[2]).toBeCloseTo(expected[2], 4);
  });
});

describe("transformReturns — rate caps (PDF p.6: +200%/−100%)", () => {
  const L = [[1]]; // trivial 1×1
  const mu = [0];

  it("caps upside at +200% (r = 2.0)", () => {
    // Z that produces y = 10 → exp(10) - 1 ≈ 22025, must be capped at 2.0
    const r = transformReturns(L, mu, [10]);
    expect(r[0]).toBe(2.0);
  });

  it("caps downside at -100% (r = -1.0)", () => {
    // Z that produces y = -50 → exp(-50) - 1 ≈ -1 already, but explicit cap
    const r = transformReturns(L, mu, [-50]);
    expect(r[0]).toBe(-1.0);
  });

  it("does not clip values within the cap range", () => {
    const r = transformReturns(L, mu, [0.5]);
    // exp(0.5) - 1 ≈ 0.6487 — well inside caps
    expect(r[0]).toBeCloseTo(Math.exp(0.5) - 1, 10);
  });
});

// ── createReturnEngine — end-to-end stream factory ────────────────────────

const SAMPLE_INDICES = [
  { id: "lc", arithMean: 0.1189, stdDev: 0.1527 },
  { id: "mc", arithMean: 0.1043, stdDev: 0.1672 },
  { id: "sc", arithMean: 0.0975, stdDev: 0.1501 },
];
const SAMPLE_CORR = [
  [1.0, 0.9796, 0.9843],
  [0.9796, 1.0, 0.9288],
  [0.9843, 0.9288, 1.0],
];

describe("createReturnEngine — determinism", () => {
  it("same seed + same trial index → identical per-year output", () => {
    const a = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 42 });
    const b = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 42 });
    const trialA = a.startTrial(0);
    const trialB = b.startTrial(0);
    for (let year = 0; year < 30; year++) {
      const ya = trialA.nextYear();
      const yb = trialB.nextYear();
      expect(ya).toEqual(yb);
    }
  });

  it("different seeds produce different output", () => {
    const a = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 1 });
    const b = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 2 });
    const ra = a.startTrial(0).nextYear();
    const rb = b.startTrial(0).nextYear();
    expect(ra).not.toEqual(rb);
  });

  it("different trial indices within the same seed produce different output", () => {
    const engine = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 42 });
    const t0 = engine.startTrial(0).nextYear();
    const t1 = engine.startTrial(1).nextYear();
    expect(t0).not.toEqual(t1);
  });

  it("exposes index ids in the same order as the output vector", () => {
    const engine = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 1 });
    expect(engine.indices).toEqual(["lc", "mc", "sc"]);
    const r = engine.startTrial(0).nextYear();
    expect(r.length).toBe(3);
  });
});

describe("createReturnEngine — statistical recovery (N=10k trials × 1 year)", () => {
  // Drawing one year per trial gives N=10k i.i.d. vectors; we check that the
  // empirical marginal statistics match the input parameters within tolerance.
  // Tolerances are set generously — this isn't a tight KS test, just a sanity
  // check that the pipeline composes correctly.
  const N = 10_000;
  const engine = createReturnEngine({ indices: SAMPLE_INDICES, correlation: SAMPLE_CORR, seed: 999 });
  const samples: number[][] = [];
  for (let t = 0; t < N; t++) {
    samples.push(engine.startTrial(t).nextYear());
  }
  const dims = SAMPLE_INDICES.length;

  function mean(col: number) {
    let s = 0;
    for (let t = 0; t < N; t++) s += samples[t][col];
    return s / N;
  }
  function stdev(col: number, m: number) {
    let s = 0;
    for (let t = 0; t < N; t++) s += (samples[t][col] - m) ** 2;
    return Math.sqrt(s / (N - 1));
  }
  function correlation(a: number[], b: number[], mA: number, mB: number, sdA: number, sdB: number) {
    let s = 0;
    for (let i = 0; i < N; i++) s += (a[i] - mA) * (b[i] - mB);
    return s / ((N - 1) * sdA * sdB);
  }

  it("empirical mean per index matches arithMean within 2%", () => {
    for (let i = 0; i < dims; i++) {
      const m = mean(i);
      expect(Math.abs(m - SAMPLE_INDICES[i].arithMean)).toBeLessThan(0.02);
    }
  });

  it("empirical stdev per index matches stdDev within 5%", () => {
    for (let i = 0; i < dims; i++) {
      const m = mean(i);
      const sd = stdev(i, m);
      const ratio = sd / SAMPLE_INDICES[i].stdDev;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
  });

  it("empirical pairwise correlation matches input within 0.03", () => {
    const means = Array.from({ length: dims }, (_, i) => mean(i));
    const sds = Array.from({ length: dims }, (_, i) => stdev(i, means[i]));
    const cols: number[][] = Array.from({ length: dims }, (_, i) => samples.map((s) => s[i]));
    for (let i = 0; i < dims; i++) {
      for (let j = i + 1; j < dims; j++) {
        const rho = correlation(cols[i], cols[j], means[i], means[j], sds[i], sds[j]);
        expect(Math.abs(rho - SAMPLE_CORR[i][j])).toBeLessThan(0.03);
      }
    }
  });
});

describe("createReturnEngine — input validation", () => {
  it("throws when correlation matrix dimension mismatches indices", () => {
    expect(() => createReturnEngine({
      indices: SAMPLE_INDICES,
      correlation: [[1, 0], [0, 1]], // 2×2 but 3 indices
      seed: 1,
    })).toThrow();
  });
});
