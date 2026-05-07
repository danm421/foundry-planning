import data from "../../../data/mortality/2010cm.json" with { type: "json" };

const LX: readonly number[] = data.lx;
const AGE_MAX = data.ageMax;

export function lx(age: number): number {
  if (age < 0) throw new Error(`lx: negative age ${age}`);
  if (age > AGE_MAX) return 0;
  return LX[age];
}

/** Probability of surviving from age x to age x+t. Returns 0 if x+t > AGE_MAX. */
export function survivalProbability(x: number, t: number): number {
  if (t < 0) throw new Error(`survivalProbability: negative t ${t}`);
  const lxAtX = lx(x);
  if (lxAtX === 0) return 0;
  return lx(x + t) / lxAtX;
}

/** Probability of dying in year t (between age x+t-1 and x+t), starting alive at age x. */
export function deathProbability(x: number, t: number): number {
  if (t <= 0) throw new Error(`deathProbability: t must be >= 1, got ${t}`);
  const lxAtX = lx(x);
  if (lxAtX === 0) return 0;
  return (lx(x + t - 1) - lx(x + t)) / lxAtX;
}

export const MORTALITY_TABLE_NAME = data.name;
export const MORTALITY_TABLE_EFFECTIVE_FROM = data.effectiveFrom;
