// src/lib/scenario/account-meta.ts
//
// F11 fix: per-account view-only metadata (growthSource, modelPortfolioId,
// turnoverPct, overridePct*, property-tax fields) is NOT carried on the engine
// `Account` type — `resolveAccountFromRaw` consumes it into resolved
// growthRate/realization and discards the raw fields (see
// lib/projection/resolve-entity.ts and the note in lib/scenario/view-adapters.ts).
//
// The Balance Sheet / Net Worth pages therefore fetch this metadata from a
// parallel base-row query and merge it onto the scenario-aware effectiveTree by
// id. That parallel query is base-scoped, so scenario-EDITED accounts showed
// stale base metadata and scenario-ADDED accounts fell to defaults.
//
// The overlay model keeps these edits/adds in `scenario_changes` payloads (the
// account row itself is never duplicated per scenario), so this helper overlays
// the enabled account changes onto the base meta map — mirroring
// applyChanges.ts (add = flat insert; edit = field-level {from,to} diff merged
// by id). Pure view metadata only; no engine math depends on it.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { loadScenarioChanges } from "./changes";

/** The view-only metadata columns the balance-sheet/net-worth forms read. */
export interface AccountMeta {
  id: string;
  growthSource: string | null;
  modelPortfolioId: string | null;
  tickerPortfolioId: string | null;
  turnoverPct: string | null;
  overridePctOi: string | null;
  overridePctLtCg: string | null;
  overridePctQdiv: string | null;
  overridePctTaxExempt: string | null;
  annualPropertyTax: string | null;
  propertyTaxGrowthRate: string | null;
  propertyTaxGrowthSource: string | null;
  /** Advisor-set AUM flag. Boolean, not string|null — it must not go through
   *  the String() coercion the other meta keys use. */
  countsTowardAum: boolean;
}

/** The string-valued meta keys. `countsTowardAum` is excluded deliberately —
 *  it is coerced by BOOL_META_KEYS below, not by String(). */
type StringMetaKey = Exclude<keyof AccountMeta, "id" | "countsTowardAum">;

const META_KEYS: ReadonlyArray<StringMetaKey> = [
  "growthSource",
  "modelPortfolioId",
  "tickerPortfolioId",
  "turnoverPct",
  "overridePctOi",
  "overridePctLtCg",
  "overridePctQdiv",
  "overridePctTaxExempt",
  "annualPropertyTax",
  "propertyTaxGrowthRate",
  "propertyTaxGrowthSource",
];

/** Boolean meta keys — coerced separately from META_KEYS, whose String()
 *  coercion would turn `false` into the truthy string "false". */
const BOOL_META_KEYS: ReadonlyArray<"countsTowardAum"> = ["countsTowardAum"];

/** Pull only the metadata keys out of a raw change payload, coercing to the
 *  string|null shape the base rows use. Unknown/absent keys are skipped so a
 *  partial edit diff only overrides the fields it actually changed. */
function metaFromPayload(
  payload: Record<string, unknown> | undefined,
): Partial<AccountMeta> {
  const out: Partial<AccountMeta> = {};
  if (!payload) return out;
  for (const k of META_KEYS) {
    if (!(k in payload)) continue;
    const v = payload[k];
    out[k] = v == null ? null : String(v);
  }
  for (const k of BOOL_META_KEYS) {
    if (!(k in payload)) continue;
    // scenario_changes payloads are JSON, so the value may arrive as a real
    // boolean or as the string "true" — accept both, treat anything else as false.
    out[k] = payload[k] === true || payload[k] === "true";
  }
  return out;
}

function emptyMeta(): Omit<AccountMeta, "id"> {
  return {
    growthSource: null,
    modelPortfolioId: null,
    tickerPortfolioId: null,
    turnoverPct: null,
    overridePctOi: null,
    overridePctLtCg: null,
    overridePctQdiv: null,
    overridePctTaxExempt: null,
    annualPropertyTax: null,
    propertyTaxGrowthRate: null,
    propertyTaxGrowthSource: null,
    countsTowardAum: false,
  };
}

/**
 * Pure overlay core: fold a list of (already enabled) account scenario_changes
 * onto the base metadata map. Exported separately so it can be unit-tested
 * without a DB. Mirrors applyChanges.ts add/edit/remove semantics.
 */
export function overlayAccountMeta(
  baseRows: AccountMeta[],
  changes: Array<{
    targetKind: string;
    opType: string;
    targetId: string;
    payload: unknown;
  }>,
): Map<string, AccountMeta> {
  const map = new Map<string, AccountMeta>(baseRows.map((r) => [r.id, r]));
  for (const c of changes) {
    if (c.targetKind !== "account") continue;
    if (c.opType === "add") {
      const payload = c.payload as Record<string, unknown>;
      map.set(c.targetId, {
        id: c.targetId,
        ...emptyMeta(),
        ...metaFromPayload(payload),
      });
    } else if (c.opType === "edit") {
      const diff = c.payload as Record<string, { from: unknown; to: unknown }>;
      const patch: Record<string, unknown> = {};
      for (const [k, fv] of Object.entries(diff)) patch[k] = fv?.to;
      const prev = map.get(c.targetId) ?? { id: c.targetId, ...emptyMeta() };
      map.set(c.targetId, { ...prev, ...metaFromPayload(patch) });
    } else if (c.opType === "remove") {
      map.delete(c.targetId);
    }
  }
  return map;
}

/**
 * Build the per-account metadata map for the scenario the page is displaying.
 *
 * `baseRows` are the base-scenario account metadata rows the page already
 * fetched. When `scenarioParam` is undefined / "base" / the base-case id, the
 * base map is returned unchanged (fast path — no extra query). Otherwise the
 * scenario's enabled account changes are loaded and overlaid via
 * `overlayAccountMeta`.
 */
export async function loadOverlaidAccountMeta(
  clientId: string,
  baseRows: AccountMeta[],
  scenarioParam: string | undefined,
): Promise<Map<string, AccountMeta>> {
  if (!scenarioParam || scenarioParam === "base") {
    return new Map(baseRows.map((r) => [r.id, r]));
  }

  const [scenario] = await db
    .select({ id: scenarios.id, isBaseCase: scenarios.isBaseCase })
    .from(scenarios)
    .where(and(eq(scenarios.id, scenarioParam), eq(scenarios.clientId, clientId)));
  // Unknown id, or the base case selected by id → nothing to overlay.
  if (!scenario || scenario.isBaseCase) {
    return new Map(baseRows.map((r) => [r.id, r]));
  }

  const changes = await loadScenarioChanges(scenario.id);
  return overlayAccountMeta(baseRows, changes);
}
