import type { Account, ClientInfo, FamilyMember, SavingsRule } from "./types";
import { controllingFamilyMember } from "./ownership";
import { itemProrationGate } from "./retirement-proration";
import type { TaxYearParameters } from "../lib/tax/types";

/** 401(k) / 403(b) family of payroll-deduction retirement accounts. The IRS
 *  applies ONE combined employee deferral limit across all of these per person. */
const DEFERRAL_SUB_TYPES = new Set(["401k", "403b"]);

/** Traditional + Roth IRAs share ONE combined annual limit per person. */
const IRA_SUB_TYPES = new Set(["traditional_ira", "roth_ira"]);

/** HSA — its own per-person limit, depending on coverage tier + a 55+ catch-up. */
const HSA_SUB_TYPES = new Set(["hsa"]);

type OwnerKey = "client" | "spouse" | "joint";
type LimitGroup = "deferral" | "ira" | "hsa" | "none";

function groupForSubType(subType: string): LimitGroup {
  if (DEFERRAL_SUB_TYPES.has(subType)) return "deferral";
  if (IRA_SUB_TYPES.has(subType)) return "ira";
  if (HSA_SUB_TYPES.has(subType)) return "hsa";
  return "none";
}

/** Age in a given calendar year. If `dateOfBirth` is missing or unparseable,
 *  returns 50 (per product decision — treat as "catch-up eligible" rather
 *  than crash). */
export function resolveAgeInYear(dateOfBirth: string | null | undefined, year: number): number {
  if (!dateOfBirth) return 50;
  // TZ-safe: parse the leading "YYYY" directly instead of `new Date(dob)`,
  // which treats a date-only ISO string as UTC midnight and reads the wrong
  // year via `.getFullYear()` in any negative-UTC-offset zone (audit F5).
  // Matches the `dob.slice(0,4)` convention used everywhere else in the engine.
  const birthYear = parseInt(dateOfBirth.slice(0, 4), 10);
  if (Number.isNaN(birthYear)) return 50;
  return year - birthYear;
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

/** HSA contribution limit for a given age + coverage tier. Self vs family
 *  base, plus the $1,000-ish catch-up once age >= 55 (HSA catch-up is 55, not
 *  50). Coverage defaults to "self" (the lower cap) when unknown. */
export function computeHsaLimit(
  params: TaxYearParameters,
  age: number,
  coverage: "self" | "family" | undefined
): number {
  const base =
    coverage === "family"
      ? params.contribLimits.hsaLimitFamily
      : params.contribLimits.hsaLimitSelf;
  return age >= 55 ? base + params.contribLimits.hsaCatchup55 : base;
}

/** Resolves a rule's "contribute the IRS max" intent to a dollar amount for
 *  a given subtype and owner age. Non-retirement subtypes resolve to 0
 *  (Max has no meaning for a brokerage or cash account). `coverage` only
 *  matters for HSAs; it's ignored for the deferral / IRA groups. */
export function computeMaxContribution(
  subType: string,
  params: TaxYearParameters,
  age: number,
  coverage?: "self" | "family"
): number {
  const group = groupForSubType(subType);
  if (group === "deferral") return computeDeferralLimit(params, age);
  if (group === "ira") return computeIraLimit(params, age);
  if (group === "hsa") return computeHsaLimit(params, age, coverage);
  return 0;
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
  /** Household family members — used to derive per-person owner key from owners[]. */
  familyMembers?: FamilyMember[];
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
  const { year, rules, accounts, client, taxYearParams, resolvedByRuleId, familyMembers } = input;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const cappedByRuleId: Record<string, number> = { ...resolvedByRuleId };
  const adjustments: CapAdjustment[] = [];

  // Derive FM ids for principal owner classification.
  const clientFmId = (familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = (familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;

  /** Derive "client" | "spouse" | "joint" from owners[]. Falls back to "client"
   *  for entity-owned or unclassifiable accounts (rare for retirement accounts). */
  function ownerKeyFor(acct: Account): OwnerKey {
    const cfm = controllingFamilyMember(acct);
    if (cfm != null && cfm === spouseFmId) return "spouse";
    if (cfm != null && cfm === clientFmId) return "client";
    // Multiple FM owners or single FM owner that is neither principal: treat as joint.
    return "joint";
  }

  // Pre-compute age + limits per owner. "joint" falls back to the client's
  // age for cap purposes (joint retirement accounts are rare; document as a
  // simplification).
  const clientAge = resolveAgeInYear(client.dateOfBirth, year);
  const spouseAge = resolveAgeInYear(client.spouseDob, year);

  // Per-owner HSA coverage: family if the owner holds any family-coverage HSA,
  // else self. Used to pick the per-owner HSA limit.
  function hsaCoverageFor(owner: OwnerKey): "self" | "family" {
    const ownerHsas = accounts.filter(
      (a) => a.subType === "hsa" && ownerKeyFor(a) === owner
    );
    return ownerHsas.some((a) => a.hsaCoverage === "family") ? "family" : "self";
  }

  const limits: Record<OwnerKey, { deferral: number; ira: number; hsa: number }> = {
    client: {
      deferral: computeDeferralLimit(taxYearParams, clientAge),
      ira: computeIraLimit(taxYearParams, clientAge),
      hsa: computeHsaLimit(taxYearParams, clientAge, hsaCoverageFor("client")),
    },
    spouse: {
      deferral: computeDeferralLimit(taxYearParams, spouseAge),
      ira: computeIraLimit(taxYearParams, spouseAge),
      hsa: computeHsaLimit(taxYearParams, spouseAge, hsaCoverageFor("spouse")),
    },
    joint: {
      deferral: computeDeferralLimit(taxYearParams, clientAge),
      ira: computeIraLimit(taxYearParams, clientAge),
      hsa: computeHsaLimit(taxYearParams, clientAge, hsaCoverageFor("joint")),
    },
  };

  // Shared-family HSA case (IRC §223(b)(5) / Pub 969): the family HSA maximum
  // is ONE limit shared by both spouses under the same family HDHP, divided
  // between them — only the $1,000 age-55 catch-up is per-individual. When
  // BOTH a client-owned and a spouse-owned HSA carry family coverage, their
  // contributions share a single family base; capping each owner bucket at
  // the full family limit independently would let the couple double the cap.
  const sharedFamilyHsa =
    hsaCoverageFor("client") === "family" && hsaCoverageFor("spouse") === "family";
  // Combined cap: one family base + each spouse's own catch-up (faithful to
  // §223(b)(5)'s "any agreed division" — cap the SUM, leave the split open).
  const sharedFamilyHsaLimit =
    taxYearParams.contribLimits.hsaLimitFamily +
    (clientAge >= 55 ? taxYearParams.contribLimits.hsaCatchup55 : 0) +
    (spouseAge >= 55 ? taxYearParams.contribLimits.hsaCatchup55 : 0);

  // Bucket key for an owner+group. In the shared-family-HSA case the client
  // and spouse HSA buckets merge into one so the family base is capped once.
  const SHARED_HSA_OWNER = "joint" as const; // placeholder owner for the merged bucket
  function bucketKeyFor(owner: OwnerKey, group: "deferral" | "ira" | "hsa"): string {
    if (group === "hsa" && sharedFamilyHsa && (owner === "client" || owner === "spouse")) {
      return `shared:hsa`;
    }
    return `${owner}:${group}`;
  }

  // Bucket capped-in rules by owner+group.
  interface Bucket {
    owner: OwnerKey;
    group: "deferral" | "ira" | "hsa";
    ruleIds: string[];
    total: number;
    /** Pre-resolved limit for the merged shared-family HSA bucket. */
    sharedLimit?: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const rule of rules) {
    // Inclusion (not factor): proration of the contribution itself happens in
    // applySavingsRules. Here we only need end-at-retirement rules to remain
    // in their bucket during the retirement year so a same-bucket pair (one
    // ending at retirement, one starting at retirement) doesn't over-cap.
    const gate = itemProrationGate(rule, year, client);
    if (!gate.include) continue;
    if (rule.applyContributionLimit === false) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct) continue;
    const group = groupForSubType(acct.subType);
    if (group === "none") continue;
    const amount = resolvedByRuleId[rule.id] ?? 0;
    if (amount <= 0) continue;
    const owner = ownerKeyFor(acct);
    const merged = group === "hsa" && sharedFamilyHsa && (owner === "client" || owner === "spouse");
    const key = bucketKeyFor(owner, group);
    const b =
      buckets.get(key) ??
      {
        owner: merged ? SHARED_HSA_OWNER : owner,
        group,
        ruleIds: [],
        total: 0,
        ...(merged ? { sharedLimit: sharedFamilyHsaLimit } : {}),
      };
    b.ruleIds.push(rule.id);
    b.total += amount;
    buckets.set(key, b);
  }

  // Scale each over-cap bucket down proportionally.
  for (const bucket of buckets.values()) {
    const limit = bucket.sharedLimit ?? limits[bucket.owner][bucket.group];
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
