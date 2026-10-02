// src/engine/ltc-event.ts
//
// Long-term care stress event → ordinary rows. Pure. Called once, as the
// FIRST statement of runProjection (the destructure that follows it must see
// the care-adjusted client and horizon). Monte Carlo calls runProjection once
// per trial on the same input, so nothing here may mutate `data`.
//
// Spec: vault specs/2026-10-01-long-term-care-design.md.

import type {
  AssetTransaction,
  ClientData,
  ClientInfo,
  Expense,
  LtcCarePerson,
  ScaleWindow,
} from "./types";
import { resolveRefYears } from "@/lib/year-refs";
import { ltcPersonFirstName } from "@/lib/ltc/ltc-event-name";

const ASSUMED_LIFE_EXPECTANCY = 95; // the engine-wide fallback (death-event/shared.ts)

export const ltcCareExpenseId = (eventId: string, person: "client" | "spouse"): string =>
  `ltc-care-${eventId}-${person}`;
export const ltcHomeSaleId = (eventId: string): string => `ltc-home-sale-${eventId}`;

export type LtcWarning =
  | { kind: "multiple_events" }
  | { kind: "missing_dob"; person: "client" | "spouse" }
  | { kind: "start_before_plan"; person: "client" | "spouse"; startYear: number }
  | { kind: "home_missing"; accountId: string }
  | { kind: "home_already_sold"; accountId: string; soldYear: number };

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
}

function birthYearOf(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const y = parseInt(String(dob).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

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
    const by = birthYearOf(p.person === "client" ? client.dateOfBirth : client.spouseDob);
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

  const careRanges = toRanges(
    people.flatMap((p) => Array.from({ length: p.years }, (_, i) => p.startYear + i)),
  );

  let homeSale: LtcResolution["homeSale"] = null;
  if (event.homeSale) {
    const { accountId, saleYear } = event.homeSale;
    if (!data.accounts.some((a) => a.id === accountId)) {
      warnings.push({ kind: "home_missing", accountId });
    } else {
      const earlier = (data.assetTransactions ?? []).find(
        (t) =>
          t.type === "sell" &&
          t.enabled !== false &&
          t.accountId === accountId &&
          (t.fractionSold == null || t.fractionSold >= 1) &&
          t.year < saleYear,
      );
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
  const clientBy = birthYearOf(client.dateOfBirth)!;
  const spouseBy = birthYearOf(client.spouseDob);
  const finalDeathYear = Math.max(
    clientBy + client.lifeExpectancy!,
    spouseBy != null ? spouseBy + (client.spouseLifeExpectancy ?? ASSUMED_LIFE_EXPECTANCY) : -Infinity,
  );
  const extends_ = finalDeathYear > planSettings.planEndYear;
  if (extends_) client = { ...client, planEndAge: finalDeathYear - clientBy };

  // 2. Care-cost rows (medical-deductible in full until Phase 2's benefits).
  const careRows: Expense[] = resolution.people.map((p) => {
    const medical: Record<number, number> = {};
    for (let y = p.startYear; y <= p.endYear; y++) {
      medical[y] = p.annualCost * Math.pow(1 + p.costInflation, y - planStartYear);
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

  // 3. Living-expense cut — household living rows only, one window per merged range.
  const cut = event.livingExpenseCutPct;
  const windows: ScaleWindow[] =
    cut != null && cut > 0 ? resolution.careRanges.map((r) => ({ ...r, factor: 1 - cut })) : [];
  const expenses = data.expenses.map((e) =>
    windows.length > 0 && e.type === "living" && e.ownerEntityId == null && e.ownerAccountId == null
      ? { ...e, scaleWindows: [...(e.scaleWindows ?? []), ...windows] }
      : e,
  );

  // 4. Home sale — a plain full sell; the existing sale code does payoff/§121/proceeds.
  const sale: AssetTransaction[] = [];
  if (resolution.homeSale && event.homeSale) {
    sale.push({
      id: ltcHomeSaleId(event.id),
      name: "Home sale — long-term care",
      type: "sell",
      year: event.homeSale.saleYear,
      accountId: event.homeSale.accountId,
      overrideSaleValue: event.homeSale.price.mode === "custom" ? event.homeSale.price.amount : undefined,
      transactionCostPct: event.homeSale.sellingCostPct,
      qualifiesForHomeSaleExclusion: true,
      fractionSold: null,
    });
  }

  let next: ClientData = {
    ...data,
    client,
    planSettings: extends_ ? { ...planSettings, planEndYear: finalDeathYear } : planSettings,
    expenses: [...expenses, ...careRows],
    assetTransactions: sale.length > 0 ? [...(data.assetTransactions ?? []), ...sale] : data.assetTransactions,
  };
  // A later horizon moves plan_end / client_end anchored rows with it — the
  // same re-anchor the Solver's life-expectancy lever runs (apply-mutations).
  if (extends_) next = resolveRefYears(next);
  return { data: next, resolution };
}

/** §213 medical expenses for `year`, before the 7.5% floor. */
export function medicalDeductibleForYear(expenses: Expense[], year: number): number {
  let total = 0;
  for (const e of expenses) total += e.medicalDeductibleByYear?.[year] ?? 0;
  return total;
}
