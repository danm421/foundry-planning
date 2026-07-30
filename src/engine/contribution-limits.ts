import type { Account, ClientInfo, FamilyMember, SavingsRule } from "./types";
import { controllingFamilyMember, type OwnedThing } from "./ownership";
import { itemProrationGate } from "./retirement-proration";
import type { IraOwnerKey } from "../lib/tax/derive-deductions";
import type { FilingStatus, TaxYearParameters } from "../lib/tax/types";
import { rothIraAllowedContribution } from "../lib/tax/thresholds";

/** 401(k) / 403(b) family of payroll-deduction retirement accounts. The IRS
 *  applies ONE combined employee deferral limit across all of these per person. */
const DEFERRAL_SUB_TYPES = new Set(["401k", "403b"]);

/** Traditional + Roth IRAs share ONE combined annual limit per person. */
const IRA_SUB_TYPES = new Set(["traditional_ira", "roth_ira"]);

/** HSA — its own per-person limit, depending on coverage tier + a 55+ catch-up. */
const HSA_SUB_TYPES = new Set(["hsa"]);

/** Slack on the Roth gate's over-limit test, in dollars.
 *
 *  The age-based pass scales a bucket by `original * (limit / total)`, and
 *  those products routinely sum to one ULP ABOVE `limit` — e.g. rules of 25
 *  and 7,825 against a 7,000 cap land on 7,000.000000000001. When an owner's
 *  whole IRA bucket is Roth, that overshoot IS the gate's `total`, while
 *  `allowed` is exactly the un-nudged age-based limit. A strict `<=` would
 *  then fire the gate on float noise alone, emitting ~1e-12 backdoor amounts
 *  and phantom adjustment rows for a client nowhere near the phase-out.
 *
 *  A millionth of a dollar is orders of magnitude below any split worth
 *  reporting and orders of magnitude above the ~1e-12 noise floor. */
const ROTH_GATE_EPSILON = 1e-6;

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

/**
 * Which taxpayer's §219(b) annual limit an IRA contribution counts against.
 *
 * An IRA is individually owned by statute (the "I" in IRA), so an account that
 * does not resolve to a single 100% family-member owner is attributed to the
 * CLIENT rather than given a bucket of its own the way `applyContributionLimits`
 * treats "joint". A separate joint bucket here would hand the household an
 * extra full ceiling no taxpayer is entitled to.
 *
 * ⚠️ This is the ONE definition of the rule. `deriveAboveLineFromSavings`
 * buckets contributions by the key this returns and
 * `traditionalIraAnnualLimitBasis` prices those same buckets, so a second
 * copy of the mapping would let the ceiling be computed over a different set
 * of people than the contributions it bounds.
 */
export function iraOwnerKey(
  account: OwnedThing,
  spouseFamilyMemberId: string | null
): IraOwnerKey {
  const fmId = controllingFamilyMember(account);
  return fmId != null && fmId === spouseFamilyMemberId ? "spouse" : "client";
}

/**
 * The IRC §219(b) annual-IRA-limit basis PER OWNER — the figure IRC
 * 219(g)(2)(A) applies each individual's deduction phase-out fraction TO.
 *
 * §219(g) is a PER-INDIVIDUAL phase-out, so this returns one limit per
 * taxpayer rather than a household sum: pooling them lets a $1 contribution
 * from one spouse buy a full extra $7,000 of ceiling for the other, because
 * the "did this owner contribute" gate is a threshold at $0 and not anything
 * proportional.
 *
 * The limit is PER PERSON, so an owner's two IRAs share one $7,000 (or $8,000
 * catch-up) limit — which falls out of the bucketing rather than needing a
 * de-duplication pass here.
 *
 * ⚠️ Pass ONLY accounts that contributed. An owner who contributed nothing
 * gets a basis of 0, not their statutory limit — crediting them would
 * over-deduct, the mirror image of the contribution-basis bug the annual-limit
 * parameter exists to fix.
 */
export function traditionalIraAnnualLimitBasis(input: {
  accountIdsByOwner: Record<IraOwnerKey, string[]>;
  client: ClientInfo;
  year: number;
  taxYearParams: TaxYearParameters;
}): Record<IraOwnerKey, number> {
  const { accountIdsByOwner, client, year, taxYearParams } = input;
  const basisFor = (owner: IraOwnerKey): number => {
    if (accountIdsByOwner[owner].length === 0) return 0;
    const dob = owner === "spouse" ? client.spouseDob : client.dateOfBirth;
    return computeIraLimit(taxYearParams, resolveAgeInYear(dob, year));
  };
  return { client: basisFor("client"), spouse: basisFor("spouse") };
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
  /** Which rule produced this entry. `age_limit` means the contribution was
   *  actually REDUCED to the annual IRS ceiling. `roth_magi_backdoor` means
   *  nothing was reduced — the amount above `cappedAmount` is simply routed
   *  through a backdoor conversion instead of a direct Roth contribution. */
  reason: "age_limit" | "roth_magi_backdoor";
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
  /** MAGI for the Roth phase-out (IRC 408A(c)(3)(C)(i)) — the household's, for
   *  the year. Only the Roth gate reads it. */
  magiForRoth: number;
  /** Filing status for THIS projection year. Must be the caller's year-varying
   *  status (a surviving spouse's changes mid-projection), NOT the static
   *  `client.filingStatus`. */
  filingStatus: FilingStatus;
}

export interface ApplyLimitsResult {
  /** Rule-id → final (capped, or unchanged) contribution for the year. */
  cappedByRuleId: Record<string, number>;
  /** One entry per rule that was reduced by a cap or split by the Roth gate. */
  adjustments: CapAdjustment[];
  /** Rule-id → the portion of `cappedByRuleId` that the Roth MAGI phase-out
   *  disallows as a DIRECT contribution and that therefore has to arrive as a
   *  backdoor conversion. Only rules with a non-zero backdoor portion appear.
   *  It is a slice of `cappedByRuleId`, never an addition to it. */
  backdoorByRuleId: Record<string, number>;
}

/** Aggregates per owner+group, compares to the per-owner limit, and scales
 *  each contributing rule down proportionally when the group is over. Rules
 *  with `applyContributionLimit === false` bypass the cap entirely AND do
 *  not count against the group bucket.
 *
 *  A second pass then applies the Roth MAGI gate to the post-cap amounts. That
 *  one re-tags rather than reduces — see the block comment on it below. */
export function applyContributionLimits(input: ApplyLimitsInput): ApplyLimitsResult {
  const { year, rules, accounts, client, taxYearParams, resolvedByRuleId, familyMembers,
          magiForRoth, filingStatus } = input;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const cappedByRuleId: Record<string, number> = { ...resolvedByRuleId };
  const adjustments: CapAdjustment[] = [];
  const backdoorByRuleId: Record<string, number> = {};

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
        reason: "age_limit",
      });
    }
  }

  // ── Roth MAGI gate (IRC 408A(c)(3)) ──────────────────────────────────────
  // Above the phase-out band a taxpayer may not contribute to a Roth IRA
  // DIRECTLY. They can still get the money in, by contributing to a
  // traditional IRA and converting — the "backdoor Roth". So the disallowed
  // remainder is re-tagged, not dropped: `cappedByRuleId` is untouched here
  // and account balances are identical either way. Only the tax treatment of
  // the remainder differs, and that is what `backdoorByRuleId` carries.
  //
  // Runs on the POST-age-cap amounts: the statutory Roth allowance can never
  // exceed the annual IRA limit the previous pass already enforced.
  //
  // Known simplifications:
  //  - IRC 408(d)(2) pro-rata rule is NOT modeled. A conversion is treated as
  //    tax-free. A client holding pre-tax traditional IRA balances converts a
  //    blended pre-tax/after-tax share and owes tax on the pre-tax part, which
  //    this misses.
  //  - IRC 408A(c)(2) reduces the Roth limit by the SAME year's traditional
  //    IRA contributions. That is handled only insofar as the shared IRA
  //    bucket above already caps the combined traditional + Roth total; the
  //    Roth allowance itself is computed against the full age-based limit.

  // The allowance is per PERSON, so collect each owner's Roth rules and gate
  // the owner's total once. Guards mirror the bucket pass exactly — in
  // particular a rule with `applyContributionLimit === false` opts out of the
  // gate as well as the cap.
  const rothRulesByOwner = new Map<OwnerKey, { ruleId: string; accountId: string }[]>();
  for (const rule of rules) {
    if (!itemProrationGate(rule, year, client).include) continue;
    if (rule.applyContributionLimit === false) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct || acct.subType !== "roth_ira") continue;
    if ((cappedByRuleId[rule.id] ?? 0) <= 0) continue;
    const owner = ownerKeyFor(acct);
    const list = rothRulesByOwner.get(owner) ?? [];
    list.push({ ruleId: rule.id, accountId: acct.id });
    rothRulesByOwner.set(owner, list);
  }

  for (const [owner, ownerRules] of rothRulesByOwner) {
    const total = ownerRules.reduce((sum, r) => sum + cappedByRuleId[r.ruleId], 0);
    const allowed = rothIraAllowedContribution(
      magiForRoth,
      limits[owner].ira,
      year,
      taxYearParams,
      filingStatus
    );
    if (total <= allowed + ROTH_GATE_EPSILON) continue;
    // Split each rule pro rata so the owner's DIRECT total lands on `allowed`.
    const directScale = allowed / total;
    for (const { ruleId, accountId } of ownerRules) {
      const amount = cappedByRuleId[ruleId];
      const direct = amount * directScale;
      backdoorByRuleId[ruleId] = amount - direct;
      adjustments.push({
        ruleId,
        accountId,
        owner,
        group: "ira",
        originalAmount: amount,
        cappedAmount: direct,
        limit: allowed,
        reason: "roth_magi_backdoor",
      });
    }
  }

  return { cappedByRuleId, adjustments, backdoorByRuleId };
}
