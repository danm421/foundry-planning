// src/lib/fact-finder/placement/map/insurance.ts
/**
 * The Insurance page (D4): life policies and their beneficiaries, the group
 * coverage notes box (the AI step places it), disability and long-term care
 * policies. A value that means something only under one mode — "…to age / for
 * years", a covered earnings amount, a rider's life policy — goes to the field
 * that mode needs, or nowhere with a warning. Pure.
 */
import { LTC_RIDER_DEFAULTS } from "@/lib/schemas/ltc-policies";
import type { PlacedValue } from "../../change-set";
import {
  DI_EARNINGS_MAP, DI_PAYER_MAP, DI_RUNS_MAP, INSURED_MAP, LIFE_POLICY_TYPE_MAP, LTC_INFL_MAP, LTC_KIND_MAP,
  LTC_LAST_MAP, LTC_PAYS_MAP, LTC_PER_MAP, LTC_PREM_MAP, PAID_BY_MAP, PERSON_MAP, labelFor, type OptionMap,
} from "../../enums";
import { last4Of } from "../../identity";
import type { FFRow } from "../../types";
import { findLifePolicy } from "../refs";
import { withLast4 } from "../text";
import {
  beneficiariesOf, bool, choice, columnLabel, DraftBuilder, linkedRecord, linkedRecordId, needsCoClient, num, ownersOf, quotedLabels, rate, text,
} from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

/** A column whose value belongs to whichever field its mode names. */
interface ByMode { column: string; modeColumn: string; modes: OptionMap; keyOf: Readonly<Record<string, string>> }

/**
 * Puts the column's value under the field `mode` names — the mode the policy
 * has or will get (the row's, else the record's, else a new policy's default).
 * Under any other mode the value isn't placed, and a warning says why.
 */
function putByMode(b: DraftBuilder, sectionId: string, row: FFRow, route: ByMode, mode: PlacedValue | undefined): void {
  const value = num(row, route.column);
  if (value === null) return;
  const key = typeof mode === "string" ? route.keyOf[mode] : undefined;
  if (key) {
    b.put(key, value, [route.column]);
    return;
  }
  const modes = Object.keys(route.keyOf).map((v) => `"${labelFor(route.modes, v)}"`).join(" or ");
  b.warn(`"${columnLabel(sectionId, route.column)}" is saved only when ${columnLabel(sectionId, route.modeColumn)} is ${modes}.`);
}

// ---- life ---------------------------------------------------------------------

/** A life policy's beneficiary tiers, and the columns that fill them. */
const TIERS = [["primary", "primaryBeneficiary"], ["contingent", "contingentBeneficiary"]] as const;

/** Owner + "Which trust / entity" → the policy's owner (D7): a person, "joint" or a trust. "Other" names no one. */
function putPolicyOwner(b: DraftBuilder, row: FFRow, ctx: PlaceContext, existing: boolean): void {
  const owner = text(row, "owner");
  if (owner === "Other") {
    if (existing) b.warn('Owner "Other" names no one, so the owner on record stays.');
    else b.block('Owner "Other" needs a name — pick another owner, or add this policy in Details.', "owner");
    return;
  }
  const owners = ownersOf("life", row, ctx, { create: !existing });
  if (!owners.ok) b.block(owners.reason, owners.columnId);
  else b.put("ownerRef", owner === "Joint" ? "joint" : owners.owners[0]?.who, owners.columns);
}

export const LIFE_MAP: SectionMap = {
  sectionId: "life",
  placements: {
    policyName: { to: "life_insurance_policy.name" },
    carrier: { to: "life_insurance_policy.carrier" },
    policyType: { to: "life_insurance_policy.policyType" },
    insured: { to: "life_insurance_policy.insuredPerson" },
    owner: { to: "life_insurance_policy.ownerRef" },
    deathBenefit: { to: "life_insurance_policy.faceValue" },
    cashValue: { to: "life_insurance_policy.cashValue" },
    costBasis: { to: "life_insurance_policy.costBasis" },
    annualPremium: { to: "life_insurance_policy.premiumAmount" },
    premiumPaidBy: { to: "life_insurance_policy.premiumPayer" },
    premiumPaymentYears: { to: "life_insurance_policy.premiumYears" },
    termIssueYear: { to: "life_insurance_policy.termIssueYear" },
    termLengthYears: { to: "life_insurance_policy.termLengthYears" },
    termEndsAtRetirement: { to: "life_insurance_policy.endsAtInsuredRetirement" },
    policyNumber: { to: "life_insurance_policy.policyNumberLast4" },
    primaryBeneficiary: { to: "life_insurance_policy_beneficiary.beneficiaries" },
    contingentBeneficiary: { to: "life_insurance_policy_beneficiary.beneficiaries" },
    ownerEntity: { to: "life_insurance_policy.ownerRef" },
  },
  place(rows, ctx) {
    return rows.flatMap((row) => {
      const recordId = linkedRecordId(row, ctx, ["life_insurance_policy"]);
      const name = text(row, "policyName");
      const l4 = last4Of(text(row, "policyNumber"));
      const label = name ?? withLast4(text(row, "carrier") ?? "Life policy", l4);
      const insured = choice(INSURED_MAP, row, "insured");
      const endsAtRetirement = bool(row, "termEndsAtRetirement");
      const length = num(row, "termLengthYears");
      const b = new DraftBuilder({ sectionId: "life", row, target: "life_insurance_policy", recordId, label })
        .put("name", name, ["policyName"])
        .put("carrier", text(row, "carrier"), ["carrier"])
        .put("policyNumberLast4", l4 || null, ["policyNumber"])
        .put("policyType", choice(LIFE_POLICY_TYPE_MAP, row, "policyType"), ["policyType"])
        .put("insuredPerson", insured, ["insured"]);
      putPolicyOwner(b, row, ctx, recordId !== null);
      b.put("faceValue", num(row, "deathBenefit"), ["deathBenefit"])
        .put("cashValue", num(row, "cashValue"), ["cashValue"])
        .put("costBasis", num(row, "costBasis"), ["costBasis"])
        .put("premiumAmount", num(row, "annualPremium"), ["annualPremium"])
        .put("premiumPayer", choice(PAID_BY_MAP, row, "premiumPaidBy"), ["premiumPaidBy"])
        .put("premiumYears", num(row, "premiumPaymentYears"), ["premiumPaymentYears"])
        .put("termIssueYear", num(row, "termIssueYear"), ["termIssueYear"])
        // A term ends after its length or at the insured's retirement, never both: each clears the other on the record.
        .put("termLengthYears", endsAtRetirement === true ? null : length, ["termLengthYears"], { endsAtInsuredRetirement: false })
        .put("endsAtInsuredRetirement", endsAtRetirement, ["termEndsAtRetirement"], endsAtRetirement === true ? { termLengthYears: null } : undefined);
      if (endsAtRetirement === true && length !== null) {
        b.warn("A term policy ends after its length or at the insured's retirement, not both — the term length isn't saved.");
      }
      needsCoClient(b, ctx, insured, "insured");
      const beneficiaries = beneficiariesOf(b, row, ctx, { target: "life_insurance_policy_beneficiary", tiers: TIERS, recordId, label });
      return beneficiaries ? [b.build(), beneficiaries] : [b.build()];
    });
  },
};

/** Group / employer coverage: free text for the AI step (the runner makes it a leftover). */
export const INSURANCE_NOTES_MAP: SectionMap = {
  sectionId: "insurance_notes",
  placements: { notes: { note: "insurance" } },
  place: () => [],
};

// ---- disability -------------------------------------------------------------------

const DI_EARNINGS_AMOUNT: ByMode = {
  column: "coveredEarningsAmount", modeColumn: "coveredEarnings", modes: DI_EARNINGS_MAP, keyOf: { manual: "coveredEarningsAmount" },
};
const DI_BENEFITS_RUN: ByMode = {
  column: "benefitsRunValue", modeColumn: "benefitsRun", modes: DI_RUNS_MAP,
  keyOf: { to_age: "ltdBenefitPeriodAge", years: "ltdBenefitPeriodYears" },
};

/** A monthly cap: blank is uncapped (no field — never a 0, which pays nothing), and a typed $0 isn't saved either. */
function monthlyCap(b: DraftBuilder, row: FFRow, columnId: string): number | null {
  const cap = num(row, columnId);
  if (cap !== 0) return cap;
  b.warn(`"${columnLabel("disability", columnId)}" of $0 would pay nothing, so it isn't saved — leave it blank for no cap.`);
  return null;
}

/** Each coverage question, and the cells that describe that coverage. */
const COVERAGE = [
  ["hasShortTerm", "shortTerm", ["stdWaitingDays", "stdBenefitPercent", "stdDurationWeeks", "stdMonthlyCap"]],
  ["hasLongTerm", "longTerm", ["ltdWaitingDays", "ltdBenefitPercent", "ltdMonthlyCap", "benefitsRun", "benefitsRunValue"]],
] as const;

/**
 * A new policy's blank "Short-term coverage?" / "Long-term coverage?",
 * answered by that coverage's own cells — Yes when any is filled (a detail that
 * didn't read was filled), else No. The answer is what the policy is created
 * with (`fixed`, as INFLATION is), not a field: unticking a field brings back
 * the create schema's default (Yes, with its own terms), which would add
 * coverage the fact finder never mentions. A question cell that didn't read
 * gets no answer; a stated answer is its field.
 */
function inferredCoverage(row: FFRow, ctx: PlaceContext): Record<string, boolean> {
  const filled = (c: string) => num(row, c) !== null || text(row, c) !== null || ctx.removed(row.id, c);
  return Object.fromEntries(
    COVERAGE.filter(([, columnId]) => bool(row, columnId) === null && !ctx.removed(row.id, columnId))
      .map(([key, , details]) => [key, details.some(filled)]),
  );
}

export const DISABILITY_MAP: SectionMap = {
  sectionId: "disability",
  placements: {
    policyName: { to: "disability_policy.name" },
    carrier: { to: "disability_policy.carrier" },
    whoIsCovered: { to: "disability_policy.insured" },
    coveredEarnings: { to: "disability_policy.coveredEarningsMode" },
    coveredEarningsAmount: { to: "disability_policy.coveredEarningsAmount" },
    shortTerm: { to: "disability_policy.hasShortTerm" },
    stdWaitingDays: { to: "disability_policy.stdEliminationDays" },
    stdBenefitPercent: { to: "disability_policy.stdBenefitPct" },
    stdDurationWeeks: { to: "disability_policy.stdDurationWeeks" },
    stdMonthlyCap: { to: "disability_policy.stdMonthlyMax" },
    longTerm: { to: "disability_policy.hasLongTerm" },
    ltdWaitingDays: { to: "disability_policy.ltdEliminationDays" },
    ltdBenefitPercent: { to: "disability_policy.ltdBenefitPct" },
    ltdMonthlyCap: { to: "disability_policy.ltdMonthlyMax" },
    benefitsRun: { to: "disability_policy.ltdBenefitPeriodMode" },
    // To age → ltdBenefitPeriodAge; For a number of years → ltdBenefitPeriodYears (DI_BENEFITS_RUN).
    benefitsRunValue: { to: "disability_policy.ltdBenefitPeriodAge" },
    benefitsTaxable: { to: "disability_policy.benefitTaxable" },
    annualIncrease: { to: "disability_policy.colaRate" },
    annualPremium: { to: "disability_policy.annualPremium" },
    premiumPayer: { to: "disability_policy.premiumPayer" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const record = linkedRecord(row, ctx, ["disability_policy"]);
      const recordId = record?.id ?? null;
      const recorded = (key: string) => record?.values[key];
      const insured = choice(PERSON_MAP, row, "whoIsCovered");
      const earnings = choice(DI_EARNINGS_MAP, row, "coveredEarnings");
      const runs = choice(DI_RUNS_MAP, row, "benefitsRun");
      const coverage = recordId === null ? inferredCoverage(row, ctx) : {};
      const b = new DraftBuilder({
        sectionId: "disability", row, target: "disability_policy", recordId,
        label: text(row, "policyName") ?? text(row, "carrier") ?? "Disability policy",
        ...(Object.keys(coverage).length > 0 ? { fixed: coverage } : {}),
      })
        .put("name", text(row, "policyName"), ["policyName"])
        .put("carrier", text(row, "carrier"), ["carrier"])
        .put("insured", insured, ["whoIsCovered"])
        .put("coveredEarningsMode", earnings, ["coveredEarnings"]);
      // A new policy's modes are the create schema's defaults: Salary, To age.
      putByMode(b, "disability", row, DI_EARNINGS_AMOUNT, earnings ?? recorded("coveredEarningsMode") ?? "salary");
      b.put("hasShortTerm", bool(row, "shortTerm"), ["shortTerm"])
        .put("stdEliminationDays", num(row, "stdWaitingDays"), ["stdWaitingDays"])
        .put("stdBenefitPct", rate(row, "stdBenefitPercent"), ["stdBenefitPercent"])
        .put("stdDurationWeeks", num(row, "stdDurationWeeks"), ["stdDurationWeeks"])
        .put("stdMonthlyMax", monthlyCap(b, row, "stdMonthlyCap"), ["stdMonthlyCap"]);
      b.put("hasLongTerm", bool(row, "longTerm"), ["longTerm"])
        .put("ltdEliminationDays", num(row, "ltdWaitingDays"), ["ltdWaitingDays"])
        .put("ltdBenefitPct", rate(row, "ltdBenefitPercent"), ["ltdBenefitPercent"])
        .put("ltdMonthlyMax", monthlyCap(b, row, "ltdMonthlyCap"), ["ltdMonthlyCap"])
        .put("ltdBenefitPeriodMode", runs, ["benefitsRun"]);
      putByMode(b, "disability", row, DI_BENEFITS_RUN, runs ?? recorded("ltdBenefitPeriodMode") ?? "to_age");
      b.put("benefitTaxable", bool(row, "benefitsTaxable"), ["benefitsTaxable"])
        .put("colaRate", rate(row, "annualIncrease"), ["annualIncrease"])
        .put("annualPremium", num(row, "annualPremium"), ["annualPremium"])
        .put("premiumPayer", choice(DI_PAYER_MAP, row, "premiumPayer"), ["premiumPayer"]);
      needsCoClient(b, ctx, insured, "whoIsCovered");
      return b.build();
    });
  },
};

// ---- long-term care -------------------------------------------------------------------

const LTC_BENEFIT_YEARS: ByMode = {
  column: "benefitYears", modeColumn: "benefitsLast", modes: LTC_LAST_MAP, keyOf: { years: "benefitPeriodYears" },
};
const LTC_PREMIUM_YEARS: ByMode = {
  column: "premiumsPaidValue", modeColumn: "premiumsPaid", modes: LTC_PREM_MAP,
  keyOf: { to_age: "premiumPayToAge", years: "premiumPayYears" },
};

/**
 * What the type writes with it, so a policy on record that changes type passes
 * the edit route's rules on the merged row. A rider: the terms the fact finder
 * doesn't ask (D7: the Add dialog's rider defaults), and no premium or shared
 * care of its own. A standalone policy: no life policy and no rider terms.
 */
const { riderBenefitMode, riderMonthlyPct, riderMaxPct, extensionYears, residualDeathBenefit, annualPremium, sharedCare } = LTC_RIDER_DEFAULTS;
const RIDER_TERMS = { riderBenefitMode, riderMonthlyPct, riderMaxPct, extensionYears, residualDeathBenefit, annualPremium, sharedCare };
const STANDALONE_TERMS = { lifePolicyAccountId: null, riderBenefitMode: null, riderMonthlyPct: null, riderMaxPct: null };
/** A stated benefit amount makes a rider pay that amount (a share-of-the-death-benefit rider saves its amount as 0). */
const FIXED_BENEFIT = { riderBenefitMode: "fixed", riderMonthlyPct: null };
const NEEDS_STANDALONE_TERMS = "A standalone policy needs its benefit amount and how long benefits last.";
const pct = (fraction: number) => `${fraction * 100}%`;

export const LTC_MAP: SectionMap = {
  sectionId: "ltc",
  placements: {
    policyName: { to: "ltc_policy.name" },
    carrier: { to: "ltc_policy.carrier" },
    whoIsCovered: { to: "ltc_policy.insured" },
    policyType: { to: "ltc_policy.kind" },
    riderLifePolicy: { to: "ltc_policy.lifePolicyAccountId" },
    issueYear: { to: "ltc_policy.issueYear" },
    benefitAmount: { to: "ltc_policy.benefitAmount" },
    benefitPer: { to: "ltc_policy.benefitUnit" },
    benefitsLast: { to: "ltc_policy.benefitPeriodMode" },
    benefitYears: { to: "ltc_policy.benefitPeriodYears" },
    waitingDays: { to: "ltc_policy.eliminationDays" },
    homeCarePercent: { to: "ltc_policy.homeCarePct" },
    policyPays: { to: "ltc_policy.benefitType" },
    sharedCare: { to: "ltc_policy.sharedCare" },
    statePartnership: { to: "ltc_policy.partnership" },
    inflationProtection: { to: "ltc_policy.inflationRider" },
    inflationRate: { to: "ltc_policy.inflationRate" },
    annualPremium: { to: "ltc_policy.annualPremium" },
    premiumsPaid: { to: "ltc_policy.premiumPayMode" },
    // To age → premiumPayToAge; For a number of years → premiumPayYears (LTC_PREMIUM_YEARS).
    premiumsPaidValue: { to: "ltc_policy.premiumPayToAge" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const record = linkedRecord(row, ctx, ["ltc_policy"]);
      const recordId = record?.id ?? null;
      const recorded = (key: string) => record?.values[key];
      const insured = choice(PERSON_MAP, row, "whoIsCovered");
      const kind = choice(LTC_KIND_MAP, row, "policyType");
      const rider = (kind ?? recorded("kind")) === "life_rider";
      const amount = num(row, "benefitAmount");
      // The terms ride with the type: written for a new policy, or one on record changing type. A stated
      // amount's fixed benefit rides with it too, so it holds when the amount equals the record's (no field).
      const kindTerms = kind === "life_rider" ? { ...RIDER_TERMS, ...(amount ? FIXED_BENEFIT : {}) } : kind === "standalone" ? STANDALONE_TERMS : undefined;
      const b = new DraftBuilder({
        sectionId: "ltc", row, target: "ltc_policy", recordId,
        label: text(row, "policyName") ?? text(row, "carrier") ?? "Long-term care policy",
      })
        .put("name", text(row, "policyName"), ["policyName"])
        .put("carrier", text(row, "carrier"), ["carrier"])
        .put("insured", insured, ["whoIsCovered"])
        .put("kind", kind, ["policyType"], kindTerms)
        .put("issueYear", num(row, "issueYear"), ["issueYear"])
        // After `kind`, so on a rider the stated amount's fixed benefit wins over the default terms.
        .put("benefitAmount", rider && !amount ? null : amount, ["benefitAmount"], rider && amount ? FIXED_BENEFIT : undefined)
        .put("benefitUnit", choice(LTC_PER_MAP, row, "benefitPer"), ["benefitPer"])
        .put("eliminationDays", num(row, "waitingDays"), ["waitingDays"])
        .put("homeCarePct", rate(row, "homeCarePercent"), ["homeCarePercent"])
        .put("benefitType", choice(LTC_PAYS_MAP, row, "policyPays"), ["policyPays"])
        .put("partnership", bool(row, "statePartnership"), ["statePartnership"])
        .put("inflationRider", choice(LTC_INFL_MAP, row, "inflationProtection"), ["inflationProtection"])
        .put("inflationRate", rate(row, "inflationRate"), ["inflationRate"]);

      if (rider) {
        if (kind === "life_rider" && recorded("kind") !== "life_rider") {
          b.warn(amount
            ? `Rider terms use the standard defaults (up to ${pct(riderMaxPct)} of the death benefit) — check them in Details.`
            : `Rider terms use the standard defaults (${pct(riderMonthlyPct)} of the death benefit a month, up to ${pct(riderMaxPct)}) — check them in Details.`);
        }
        const policyName = text(row, "riderLifePolicy");
        const policy = policyName === null ? null : findLifePolicy(ctx.refs, policyName);
        if (policy?.ok) b.put("lifePolicyAccountId", policy.ref, ["riderLifePolicy"]);
        else if (policy) b.block(policy.reason, "riderLifePolicy");
        else if (!recorded("lifePolicyAccountId")) b.block("Name the life policy this rider is on.", "riderLifePolicy");
        // What a rider stores is fixed: no benefit period or shared care, paid up, no premium of its own.
        const pays = choice(LTC_PREM_MAP, row, "premiumsPaid");
        const dropped = [
          text(row, "benefitsLast") !== null && "benefitsLast",
          num(row, "benefitYears") !== null && "benefitYears",
          bool(row, "sharedCare") === true && "sharedCare",
          pays !== null && pays !== "paid_up" && "premiumsPaid",
          num(row, "premiumsPaidValue") !== null && "premiumsPaidValue",
        ].filter((columnId) => columnId !== false);
        if (dropped.length > 0) {
          b.warn(`Not saved for a rider (only a standalone policy keeps them): ${quotedLabels("ltc", dropped)}.`);
        }
        if ((num(row, "annualPremium") ?? 0) > 0) {
          b.warn(`A rider has no premium of its own — its cost is in the life policy's premium, so "Annual premium" isn't saved.`);
        }
      } else {
        if (text(row, "riderLifePolicy") !== null) b.warn(`Only a rider is linked to a life policy, so "Life policy (if rider)" isn't saved.`);
        const lasts = choice(LTC_LAST_MAP, row, "benefitsLast");
        const pays = choice(LTC_PREM_MAP, row, "premiumsPaid");
        b.put("benefitPeriodMode", lasts, ["benefitsLast"]);
        putByMode(b, "ltc", row, LTC_BENEFIT_YEARS, lasts ?? recorded("benefitPeriodMode"));
        b.put("sharedCare", bool(row, "sharedCare"), ["sharedCare"])
          .put("annualPremium", num(row, "annualPremium"), ["annualPremium"])
          .put("premiumPayMode", pays, ["premiumsPaid"]);
        // A new policy's premiums are paid for life (the create schema's default).
        putByMode(b, "ltc", row, LTC_PREMIUM_YEARS, pays ?? recorded("premiumPayMode") ?? "lifetime");
        // A rider on record has no benefit period, and often a 0 amount (share of the death benefit): the row must give them.
        if (recorded("kind") === "life_rider") {
          const amountNow = amount ?? recorded("benefitAmount");
          const lastsNow = lasts ?? recorded("benefitPeriodMode");
          if (lastsNow == null) b.block(NEEDS_STANDALONE_TERMS, "benefitsLast");
          else if (!(typeof amountNow === "number" && amountNow > 0)) b.block(NEEDS_STANDALONE_TERMS, "benefitAmount");
          else if (lastsNow === "years" && (num(row, "benefitYears") ?? recorded("benefitPeriodYears")) == null) b.block(NEEDS_STANDALONE_TERMS, "benefitYears");
        }
      }
      needsCoClient(b, ctx, insured, "whoIsCovered");
      return b.build();
    });
  },
};
