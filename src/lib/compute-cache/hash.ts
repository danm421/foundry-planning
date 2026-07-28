import { createHash } from "node:crypto";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

/**
 * Bump when MC/LI engine logic or the cached payload shape changes. Folded into
 * every hash, so a bump invalidates all existing cache rows automatically.
 * 8: F3 locked-share clamp/cap + F4 orphaned-gain backstop (2026-07-18)
 * 9: F12 entity policy-row schedule + F10 termination effective balance + F13
 *    entity checking synthesis on the solver and scenario-load paths (2026-07-18)
 * 10: capital-loss support — §1222 netting, §1211(b) $3,000/$1,500(MFS)
 *     annual ordinary-income cap, §1212(b) indefinite carryforward (halved
 *     at first death, zeroed at final death), §165(c) personal-use-property
 *     loss disallowance. Two pre-existing sources of loss — Monte Carlo
 *     down-year account growth (projection.ts) and non-qualifying equity
 *     dispositions (equity/tax-events.ts) — previously flowed straight into
 *     taxable income as an UNCLAMPED, unlimited ordinary-income offset; they
 *     are now subject to the $3,000/$1,500 cap, so Monte Carlo success rates
 *     DROP slightly on this bump — the prior numbers over-deducted. Six
 *     other sites (withdrawal draws, asset sales, transfer/reinvestment
 *     basis, equity events) previously FLOORED realized losses at zero and
 *     now recognize them instead, subject to the same cap — a new deduction
 *     that didn't exist before, the opposite direction of the first change.
 *     The cap applies in BOTH tax-engine modes: `calculateTaxYearFlat` runs
 *     the same netting, so flat-mode plans (the default mode) also see their
 *     seeded Schedule D carryforward draw down $3,000/yr where it previously
 *     sat frozen. §165(c) now disallows a real-estate loss unless the account
 *     is explicitly rental/commercial (previously it keyed off the §121
 *     home-sale-exclusion checkbox, which defaults OFF), and the `sale:`
 *     drill-down row reports the post-§121/§165(c) taxable gain rather than
 *     the raw gain — so a §121-excluded residence sale no longer shows an
 *     itemized gain under a $0 total. (2026-07-28)
 */
export const ENGINE_VERSION = 10;

/** Round to 6 decimals so float representation noise can't cause spurious misses. */
function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
}

/** Deterministic serialization: sorted keys + rounded numbers. */
function canonicalize(value: unknown): unknown {
  if (typeof value === "number") return round(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashMonteCarloInputs(input: {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  trials: number;
}): string {
  const material = stableStringify({
    engineVersion: ENGINE_VERSION,
    kind: "monte_carlo",
    trials: input.trials,
    tree: input.tree,
    mc: {
      indices: input.mcPayload.indices,
      correlation: input.mcPayload.correlation,
      accountMixes: input.mcPayload.accountMixes,
      seed: input.mcPayload.seed,
      requiredMinimumAssetLevel: input.mcPayload.requiredMinimumAssetLevel,
      startingLiquidBalance: input.mcPayload.startingLiquidBalance,
    },
  });
  return createHash("sha256").update(material).digest("hex");
}

export function hashLifeInsuranceInputs(input: {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  assumptions: LiAssumptions;
}): string {
  const material = stableStringify({
    engineVersion: ENGINE_VERSION,
    kind: "life_insurance_solve",
    tree: input.tree,
    mc: {
      indices: input.mcPayload.indices,
      correlation: input.mcPayload.correlation,
      accountMixes: input.mcPayload.accountMixes,
      seed: input.mcPayload.seed,
    },
    assumptions: input.assumptions,
  });
  return createHash("sha256").update(material).digest("hex");
}

export function hashMaxSpendingInputs(input: {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  targetPoS: number;
}): string {
  const material = stableStringify({
    engineVersion: ENGINE_VERSION,
    kind: "max_spending",
    targetPoS: input.targetPoS,
    tree: input.tree,
    mc: {
      indices: input.mcPayload.indices,
      correlation: input.mcPayload.correlation,
      accountMixes: input.mcPayload.accountMixes,
      seed: input.mcPayload.seed,
      requiredMinimumAssetLevel: input.mcPayload.requiredMinimumAssetLevel,
      startingLiquidBalance: input.mcPayload.startingLiquidBalance,
    },
  });
  return createHash("sha256").update(material).digest("hex");
}
