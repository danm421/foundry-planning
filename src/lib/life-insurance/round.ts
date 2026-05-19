// Round a life-insurance need figure UP to the nearest $50,000.
// Display-only — the solver's bisection math stays exact.
const STEP = 50_000;

export function roundUpTo50k(value: number): number {
  if (value <= 0) return 0;
  return Math.ceil(value / STEP) * STEP;
}
