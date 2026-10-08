// src/engine/ltc-event.ts
//
// Long-term care stress event → ordinary rows. Pure. Called once, as the
// FIRST statement of runProjection (the destructure that follows it must see
// the care-adjusted client and horizon). Monte Carlo calls runProjection once
// per trial on the same input, so nothing here may mutate `data`.
//
// Spec: vault specs/2026-10-01-long-term-care-design.md.

import type {
  Account,
  AssetTransaction,
  ClientData,
  ClientInfo,
  Expense,
  LtcCarePerson,
  LtcPolicy,
  ScaleWindow,
} from "./types";
import {
  LTC_PREMIUM_ID_PREFIX,
  ltcPremiumExpenseId,
  synthesizeLtcBenefits,
  type LtcBenefitsResult,
  type LtcLifePolicyTerms,
  type LtcPolicyPayout,
} from "./ltc-benefits";
import { computeTermEndYear } from "./life-insurance-expiry";
import { contractDeathBenefitForYear } from "./life-insurance-schedule";
import { resolveRefYears } from "@/lib/year-refs";
import { ltcPersonFirstName } from "@/lib/ltc/ltc-event-name";
import { ASSUMED_LIFE_EXPECTANCY, planHorizonFromLifeExpectancy } from "@/lib/plan-horizon";
import { birthYearFromDob } from "@/lib/age-year";

export const ltcCareExpenseId = (eventId: string, person: "client" | "spouse"): string =>
  `ltc-care-${eventId}-${person}`;
export const ltcHomeSaleId = (eventId: string): string => `ltc-home-sale-${eventId}`;

export type LtcWarning =
  | { kind: "multiple_events" }
  | { kind: "missing_dob"; person: "client" | "spouse" }
  | { kind: "start_before_plan"; person: "client" | "spouse"; startYear: number }
  | { kind: "home_missing"; accountId: string }
  | { kind: "home_already_sold"; accountId: string; soldYear: number }
  | { kind: "rider_life_policy_missing"; policyId: string; policyName: string };

export interface ResolvedCarePerson extends LtcCarePerson {
  startYear: number;
  /** Last care year, which is also the death year. */
  endYear: number;
}

export interface LtcResolution {
  eventId: string;
  people: ResolvedCarePerson[];
  /** Union of every person's care years, as non-overlapping ranges. */
  careRanges: { startYear: number; endYear: number }[];
  homeSale: { accountId: string; saleYear: number } | null;
  warnings: LtcWarning[];
  /** What the policies pay, for the Stress row's coverage line. Set by
   *  `applyLtcEvent` when anyone is in care; `resolveLtcEvent` leaves it out. */
  coverage?: LtcCoverage;
}

export interface LtcCoveragePerson {
  person: "client" | "spouse";
  startYear: number;
  endYear: number;
  /** Nominal care cost over every care year. */
  totalCost: number;
  /** Benefits paid toward this person's care over every care year. */
  totalCovered: number;
  /** This person's own policies, in pay order. */
  policies: LtcPolicyPayout[];
}

export interface LtcCoverage {
  includePolicies: boolean;
  people: LtcCoveragePerson[];
}

/** An enabled sale of the WHOLE account. It takes effect at the start of its
 *  year. A partial sale leaves the account in the plan. */
const isFullSaleOf = (t: AssetTransaction, accountId: string): boolean =>
  t.type === "sell" &&
  t.enabled !== false &&
  t.accountId === accountId &&
  (t.fractionSold == null || t.fractionSold >= 1);

function toRanges(years: number[]): { startYear: number; endYear: number }[] {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const ranges: { startYear: number; endYear: number }[] = [];
  for (const y of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && y === last.endYear + 1) last.endYear = y;
    else ranges.push({ startYear: y, endYear: y });
  }
  return ranges;
}

/** What the event means for this plan, without changing anything. The UI
 *  calls this for the summary line and the warnings. */
export function resolveLtcEvent(data: ClientData): LtcResolution | null {
  const events = data.ltcEvents ?? [];
  if (events.length === 0) return null;
  const event = events[0];
  const warnings: LtcWarning[] = [];
  if (events.length > 1) warnings.push({ kind: "multiple_events" });
  const { client, planSettings } = data;

  const people: ResolvedCarePerson[] = [];
  for (const p of event.people) {
    const by = birthYearFromDob(p.person === "client" ? client.dateOfBirth : client.spouseDob);
    if (by == null) {
      warnings.push({ kind: "missing_dob", person: p.person });
      continue;
    }
    const startYear = by + p.startAge;
    if (startYear < planSettings.planStartYear) {
      warnings.push({ kind: "start_before_plan", person: p.person, startYear });
      continue;
    }
    people.push({ ...p, startYear, endYear: startYear + p.years - 1 });
  }

  // A rider for someone in care whose life policy is gone (the scenario
  // removed it) pays nothing; say so rather than drop it silently.
  if (event.includePolicies) {
    const lifeIds = new Set(
      data.accounts.filter((a) => a.category === "life_insurance" && a.lifeInsurance).map((a) => a.id),
    );
    for (const p of data.ltcPolicies ?? []) {
      if (p.kind !== "life_rider" || !people.some((c) => c.person === p.insured)) continue;
      if (!p.lifePolicyAccountId || !lifeIds.has(p.lifePolicyAccountId)) {
        warnings.push({ kind: "rider_life_policy_missing", policyId: p.id, policyName: p.name });
      }
    }
  }

  const careRanges = toRanges(
    people.flatMap((p) => Array.from({ length: p.years }, (_, i) => p.startYear + i)),
  );

  let homeSale: LtcResolution["homeSale"] = null;
  if (event.homeSale) {
    const { accountId, saleYear } = event.homeSale;
    if (!data.accounts.some((a) => a.id === accountId)) {
      warnings.push({ kind: "home_missing", accountId });
    } else {
      const earlier = (data.assetTransactions ?? []).find((t) => isFullSaleOf(t, accountId) && t.year <= saleYear);
      if (earlier) warnings.push({ kind: "home_already_sold", accountId, soldYear: earlier.year });
      else homeSale = { accountId, saleYear };
    }
  }

  return { eventId: event.id, people, careRanges, homeSale, warnings };
}

/** Expand the first LTC event into ordinary rows. Returns `data` itself
 *  (same reference) when there is nothing to apply. */
export function applyLtcEvent(data: ClientData): {
  data: ClientData;
  resolution: LtcResolution | null;
} {
  const resolution = resolveLtcEvent(data);
  if (!resolution || resolution.people.length === 0) return { data, resolution };
  const event = data.ltcEvents![0];
  const { planSettings } = data;
  const planStartYear = planSettings.planStartYear;

  // 1. Lifespan. Death falls in the last care year. A missing client LE is
  //    filled with the engine's 95 fallback: computeFirstDeathYear returns
  //    null without one, which would cancel a spouse-only event's death.
  let client: ClientInfo = {
    ...data.client,
    lifeExpectancy: data.client.lifeExpectancy ?? ASSUMED_LIFE_EXPECTANCY,
  };
  for (const p of resolution.people) {
    const le = p.startAge + p.years - 1;
    client = p.person === "client" ? { ...client, lifeExpectancy: le } : { ...client, spouseLifeExpectancy: le };
  }
  // The horizon is only ever extended, to the last death.
  const horizon = planHorizonFromLifeExpectancy(client);
  const extended = horizon && horizon.planEndYear > planSettings.planEndYear ? horizon : null;
  if (extended) client = { ...client, planEndAge: extended.planEndAge };

  // 2. Care cost per person and year: today's dollars grown at the care rate.
  const careCost: Record<"client" | "spouse", Record<number, number>> = { client: {}, spouse: {} };
  for (const p of resolution.people) {
    for (let y = p.startYear; y <= p.endYear; y++) {
      careCost[p.person][y] = p.annualCost * Math.pow(1 + p.costInflation, y - planStartYear);
    }
  }

  // 3. LTC policies (Part 2). "Include LTC policies" off means no coverage at
  //    all: no benefits, no rider draws, and (below) no LTC premiums.
  const policies = data.ltcPolicies ?? [];
  const benefits = event.includePolicies
    ? synthesizeLtcBenefits({
        people: resolution.people,
        careCostByPersonYear: careCost,
        policies,
        lifePolicies: riderLifePolicies(data.accounts, data.assetTransactions ?? [], policies, client),
        deathYearByPerson: lastYearAlive(client),
      })
    : null;

  // Care-cost rows. Only what the policies didn't pay is a §213 medical expense.
  const careRows: Expense[] = resolution.people.map((p) => {
    const covered = benefits?.coveredByPersonYear[p.person] ?? {};
    const medical: Record<number, number> = {};
    for (let y = p.startYear; y <= p.endYear; y++) {
      medical[y] = Math.max(0, careCost[p.person][y] - (covered[y] ?? 0));
    }
    return {
      id: ltcCareExpenseId(event.id, p.person),
      type: "other",
      name: `Long-term care — ${ltcPersonFirstName(p.person, client)}`,
      annualAmount: p.annualCost,
      startYear: p.startYear,
      endYear: p.endYear,
      growthRate: p.costInflation,
      inflationStartYear: planStartYear,
      medicalDeductibleByYear: medical,
    };
  });

  // 4. Living-expense cut — household living rows only, one window per merged
  //    range. 5. Waiver of premium — an LTC premium of a person in care stops
  //    the year before their care starts; with policies off, every LTC premium
  //    row goes.
  const cut = event.livingExpenseCutPct;
  const windows: ScaleWindow[] =
    cut != null && cut > 0 ? resolution.careRanges.map((r) => ({ ...r, factor: 1 - cut })) : [];
  const careStart = new Map(resolution.people.map((p) => [p.person, p.startYear] as const));
  const premiumPolicy = new Map(policies.map((p) => [ltcPremiumExpenseId(p.id), p] as const));
  const afterWaiver = (e: Expense): Expense | null => {
    if (!e.id.startsWith(LTC_PREMIUM_ID_PREFIX)) return e;
    if (!event.includePolicies) return null;
    const insured = premiumPolicy.get(e.id)?.insured;
    const start = insured ? careStart.get(insured) : undefined;
    if (start == null) return e;
    const endYear = Math.min(e.endYear, start - 1);
    return endYear >= e.startYear ? { ...e, endYear } : null;
  };
  const expenses = data.expenses.flatMap((e): Expense[] => {
    const kept = afterWaiver(e);
    if (!kept) return [];
    return windows.length > 0 && kept.type === "living" && kept.ownerEntityId == null && kept.ownerAccountId == null
      ? [{ ...kept, scaleWindows: [...(kept.scaleWindows ?? []), ...windows] }]
      : [kept];
  });

  // 6. Home sale — a plain full sell; the existing sale code does payoff/§121/proceeds.
  const sale: AssetTransaction[] = [];
  if (resolution.homeSale && event.homeSale) {
    const { accountId } = resolution.homeSale;
    sale.push({
      id: ltcHomeSaleId(event.id),
      name: "Home sale — long-term care",
      type: "sell",
      year: event.homeSale.saleYear,
      accountId,
      overrideSaleValue: event.homeSale.price.mode === "custom" ? event.homeSale.price.amount : undefined,
      transactionCostPct: event.homeSale.sellingCostPct,
      // §121 only for the household's home; a rental or commercial property
      // sold to pay for care gets no exclusion.
      qualifiesForHomeSaleExclusion: data.accounts.find((a) => a.id === accountId)?.subType === "primary_residence",
      fractionSold: null,
    });
  }

  // 7. Rider draws ride on the pre-pass's own copy of each life policy; the
  //    payout and the cash value read them (life-insurance-schedule.ts).
  const acceleration = benefits?.accelerationByAccount ?? {};
  const accounts =
    Object.keys(acceleration).length === 0
      ? data.accounts
      : data.accounts.map((a) =>
          acceleration[a.id] && a.lifeInsurance
            ? { ...a, lifeInsurance: { ...a.lifeInsurance, ltcAcceleration: acceleration[a.id] } }
            : a,
        );

  let next: ClientData = {
    ...data,
    client,
    planSettings: extended ? { ...planSettings, planEndYear: extended.planEndYear } : planSettings,
    accounts,
    incomes: benefits && benefits.incomes.length > 0 ? [...data.incomes, ...benefits.incomes] : data.incomes,
    expenses: [...expenses, ...careRows],
    assetTransactions: sale.length > 0 ? [...(data.assetTransactions ?? []), ...sale] : data.assetTransactions,
  };
  // A later horizon moves plan_end / client_end anchored rows with it — the
  // same re-anchor the Solver's life-expectancy lever runs (apply-mutations).
  if (extended) next = resolveRefYears(next);
  return {
    data: next,
    resolution: { ...resolution, coverage: coverageOf(resolution, careCost, benefits, event.includePolicies) },
  };
}

/** The life policies the riders name, by account id. Only named accounts are
 *  built: `computeTermEndYear` throws for a co-client retirement-term policy
 *  with no co-client retirement age, and nothing else needs it here. */
function riderLifePolicies(
  accounts: Account[],
  transactions: AssetTransaction[],
  policies: LtcPolicy[],
  client: ClientInfo,
): Record<string, LtcLifePolicyTerms> {
  const named = new Set(
    policies.flatMap((p) => (p.kind === "life_rider" && p.lifePolicyAccountId ? [p.lifePolicyAccountId] : [])),
  );
  const out: Record<string, LtcLifePolicyTerms> = {};
  for (const a of accounts) {
    const li = a.lifeInsurance;
    if (!named.has(a.id) || a.category !== "life_insurance" || !li) continue;
    // In force through its term's end (the projection drops an expired term
    // policy by this same rule) and until an enabled full sale, which takes
    // effect at the start of its year. Infinity = no end.
    const termEnd = computeTermEndYear({ policy: li, insured: a.insuredPerson ?? "client", client }) ?? Infinity;
    const firstSale = Math.min(...transactions.filter((t) => isFullSaleOf(t, a.id)).map((t) => t.year));
    const lastYear = Math.min(termEnd, firstSale - 1);
    out[a.id] = {
      faceForYear: (year) => contractDeathBenefitForYear(li, year),
      firstYear: a.activationYear ?? null,
      lastYear: Number.isFinite(lastYear) ? lastYear : null,
    };
  }
  return out;
}

/** Each person's last year alive, from the care-adjusted lifespans. A
 *  co-client's missing expectancy is 95, as in the engine's death events
 *  (`computeFirstDeathYear`) and the horizon (`planHorizonFromLifeExpectancy`). */
function lastYearAlive(client: ClientInfo): Partial<Record<"client" | "spouse", number>> {
  const out: Partial<Record<"client" | "spouse", number>> = {};
  const clientBirth = birthYearFromDob(client.dateOfBirth);
  if (clientBirth != null && client.lifeExpectancy != null) out.client = clientBirth + client.lifeExpectancy;
  const spouseBirth = birthYearFromDob(client.spouseDob);
  if (spouseBirth != null) out.spouse = spouseBirth + (client.spouseLifeExpectancy ?? ASSUMED_LIFE_EXPECTANCY);
  return out;
}

function coverageOf(
  resolution: LtcResolution,
  careCost: Record<"client" | "spouse", Record<number, number>>,
  benefits: LtcBenefitsResult | null,
  includePolicies: boolean,
): LtcCoverage {
  return {
    includePolicies,
    people: resolution.people.map((p) => {
      const years = Array.from({ length: p.years }, (_, i) => p.startYear + i);
      const covered = benefits?.coveredByPersonYear[p.person] ?? {};
      return {
        person: p.person,
        startYear: p.startYear,
        endYear: p.endYear,
        totalCost: years.reduce((sum, y) => sum + careCost[p.person][y], 0),
        totalCovered: years.reduce((sum, y) => sum + (covered[y] ?? 0), 0),
        policies: benefits?.byPolicy.filter((b) => b.person === p.person) ?? [],
      };
    }),
  };
}

/** §213 medical expenses for `year`, before the 7.5% floor. */
export function medicalDeductibleForYear(expenses: Expense[], year: number): number {
  let total = 0;
  for (const e of expenses) total += e.medicalDeductibleByYear?.[year] ?? 0;
  return total;
}
