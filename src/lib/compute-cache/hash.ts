import { createHash } from "node:crypto";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

/**
 * Bump when MC/LI engine logic or the cached payload shape changes. Folded into
 * every hash, so a bump invalidates all existing cache rows automatically.
 */
export const ENGINE_VERSION = 7;

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
