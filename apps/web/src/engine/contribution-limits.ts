import type { Account, ClientInfo, SavingsRule } from "./types";
import type { TaxYearParameters } from "../lib/tax/types";

/** 401(k) / 403(b) family of payroll-deduction retirement accounts. The IRS
 *  applies ONE combined employee deferral limit across all of these per person. */
const DEFERRAL_SUB_TYPES = new Set(["401k", "roth_401k", "403b", "roth_403b"]);

/** Traditional + Roth IRAs share ONE combined annual limit per person. */
const IRA_SUB_TYPES = new Set(["traditional_ira", "roth_ira"]);

type OwnerKey = "client" | "spouse" | "joint";
type LimitGroup = "deferral" | "ira" | "none";

function groupForSubType(subType: string): LimitGroup {
  if (DEFERRAL_SUB_TYPES.has(subType)) return "deferral";
  if (IRA_SUB_TYPES.has(subType)) return "ira";
  return "none";
}

/** Age in a given calendar year. If `dateOfBirth` is missing or unparseable,
 *  returns 50 (per product decision — treat as "catch-up eligible" rather
 *  than crash). */
export function resolveAgeInYear(dateOfBirth: string | null | undefined, year: number): number {
  if (!dateOfBirth) return 50;
  const parsed = new Date(dateOfBirth);
  if (Number.isNaN(parsed.getTime())) return 50;
  return year - parsed.getFullYear();
}

/** Employee deferral limit for a given age, per IRS SECURE 2.0 tiers:
 *  - age 60-63 (2025+): base + super catchup (when the year has catchup_60_63 set)
 *  - age 50+ (all years): base + catchup_50
 *  - under 50: base only. */
export function computeDeferralLimit(params: TaxYearParameters, age: number): number {
  const base = params.contribLimits.ira401kElective;
  if (age >= 60 && age <= 63 && params.contribLimits.ira401kCatchup6063 != null) {
    return base + params.contribLimits.ira401kCatchup6063;
  }
  if (age >= 50) {
    return base + params.contribLimits.ira401kCatchup50;
  }
  return base;
}

/** IRA limit — base plus a $1,000-ish catch-up once age >= 50. Traditional +
 *  Roth IRAs share this one limit. */
export function computeIraLimit(params: TaxYearParameters, age: number): number {
  const base = params.contribLimits.iraTradLimit;
  if (age >= 50) return base + params.contribLimits.iraCatchup50;
  return base;
}

export interface CapAdjustment {
  ruleId: string;
  accountId: string;
  owner: OwnerKey;
  group: LimitGroup;
  originalAmount: number;
  cappedAmount: number;
  limit: number;
}

export interface ApplyLimitsInput {
  year: number;
  rules: SavingsRule[];
  accounts: Account[];
  client: ClientInfo;
  taxYearParams: TaxYearParameters;
  /** Amount the rule would contribute *before* capping, keyed by rule id.
   *  Callers compute this via resolveContributionAmount so percent-mode is
   *  already resolved to a dollar figure. */
  resolvedByRuleId: Record<string, number>;
}

export interface ApplyLimitsResult {
  /** Rule-id → final (capped, or unchanged) contribution for the year. */
  cappedByRuleId: Record<string, number>;
  /** One entry per rule that was actually reduced by a cap. */
  adjustments: CapAdjustment[];
}

/** Aggregates per owner+group, compares to the per-owner limit, and scales
 *  each contributing rule down proportionally when the group is over. Rules
 *  with `applyContributionLimit === false` bypass the cap entirely AND do
 *  not count against the group bucket. */
export function applyContributionLimits(input: ApplyLimitsInput): ApplyLimitsResult {
  const { year, rules, accounts, client, taxYearParams, resolvedByRuleId } = input;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const cappedByRuleId: Record<string, number> = { ...resolvedByRuleId };
  const adjustments: CapAdjustment[] = [];

  // Pre-compute age + limits per owner. "joint" falls back to the client's
  // age for cap purposes (joint retirement accounts are rare; document as a
  // simplification).
  const clientAge = resolveAgeInYear(client.dateOfBirth, year);
  const spouseAge = resolveAgeInYear(client.spouseDob, year);

  const limits: Record<OwnerKey, { deferral: number; ira: number }> = {
    client: {
      deferral: computeDeferralLimit(taxYearParams, clientAge),
      ira: computeIraLimit(taxYearParams, clientAge),
    },
    spouse: {
      deferral: computeDeferralLimit(taxYearParams, spouseAge),
      ira: computeIraLimit(taxYearParams, spouseAge),
    },
    joint: {
      deferral: computeDeferralLimit(taxYearParams, clientAge),
      ira: computeIraLimit(taxYearParams, clientAge),
    },
  };

  // Bucket capped-in rules by owner+group.
  interface Bucket {
    owner: OwnerKey;
    group: "deferral" | "ira";
    ruleIds: string[];
    total: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const rule of rules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    if (rule.applyContributionLimit === false) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct) continue;
    const group = groupForSubType(acct.subType);
    if (group === "none") continue;
    const amount = resolvedByRuleId[rule.id] ?? 0;
    if (amount <= 0) continue;
    const owner = acct.owner as OwnerKey;
    const key = `${owner}:${group}`;
    const b = buckets.get(key) ?? { owner, group, ruleIds: [], total: 0 };
    b.ruleIds.push(rule.id);
    b.total += amount;
    buckets.set(key, b);
  }

  // Scale each over-cap bucket down proportionally.
  for (const bucket of buckets.values()) {
    const limit = limits[bucket.owner][bucket.group];
    if (bucket.total <= limit) continue;
    const scale = limit / bucket.total;
    for (const id of bucket.ruleIds) {
      const original = resolvedByRuleId[id] ?? 0;
      const capped = original * scale;
      cappedByRuleId[id] = capped;
      const acct = accountById.get(rules.find((r) => r.id === id)!.accountId)!;
      adjustments.push({
        ruleId: id,
        accountId: acct.id,
        owner: bucket.owner,
        group: bucket.group,
        originalAmount: original,
        cappedAmount: capped,
        limit,
      });
    }
  }

  return { cappedByRuleId, adjustments };
}
