// ── QCD (Qualified Charitable Distributions) ────────────────────────────────
//
// IRC §408(d)(8): a gift paid straight from an IRA to a public charity by an
// owner aged 70½ or older. The qualifying part is left out of income, earns no
// deduction and counts toward the RMD. Each owner has their own yearly cap.
// Pure rules only; the projection's RMD step applies them.

import type { QcdAmountMode, QcdEvent, QcdYearResult } from "./types";

/** Per-person yearly cap as published (§408(d)(8)(G), indexed from 2024 by
 *  SECURE 2.0 §307). A statutory table in code, like the RMD table in
 *  `rmd.ts`: add the next year each fall when the IRS publishes it. */
export const QCD_LIMIT_BY_YEAR: Readonly<Record<number, number>> = {
  2024: 105_000,
  2025: 108_000,
  2026: 111_000,
};

/** The flat cap before indexing began. */
const PRE_INDEXING_LIMIT = 100_000;
const FIRST_INDEXED_YEAR = 2024;
const LAST_PUBLISHED_YEAR = Math.max(...Object.keys(QCD_LIMIT_BY_YEAR).map(Number));

/** The yearly cap for one person. Past the last published year it grows with
 *  the tax inflation rate, rounded down to the nearest $1,000 like the IRS. */
export function qcdAnnualLimit(year: number, taxInflationRate: number): number {
  const published = QCD_LIMIT_BY_YEAR[year];
  if (published != null) return published;
  if (year < FIRST_INDEXED_YEAR) return PRE_INDEXING_LIMIT;
  const last = QCD_LIMIT_BY_YEAR[LAST_PUBLISHED_YEAR];
  return (
    Math.floor((last * (1 + taxInflationRate) ** (year - LAST_PUBLISHED_YEAR)) / 1000) * 1000
  );
}

/** First calendar year the owner is 70½ by year end. The model assumes the
 *  gift falls after the half-birthday, so that whole year is eligible. */
export function qcdEligibleFromYear(dateOfBirth: string): number {
  const birthYear = parseInt(dateOfBirth.slice(0, 4), 10);
  const birthMonth = parseInt(dateOfBirth.slice(5, 7), 10);
  return birthYear + (birthMonth <= 6 ? 70 : 71);
}

export interface QcdSpec {
  accountId: string;
  charityId: string;
  mode: QcdAmountMode;
  startYear: number;
  endYear: number;
  amount: number;
  inflationAdjust: boolean;
  sourceGiftId?: string;
  seriesId?: string;
}

/** One event per year. Fixed amounts inflate from the start year exactly as
 *  `fanOutGiftSeries` inflates a cash series; full_rmd events carry 0 because
 *  the RMD step sets the amount. */
export function fanOutQcd(spec: QcdSpec, cpi: number): QcdEvent[] {
  const events: QcdEvent[] = [];
  for (let year = spec.startYear; year <= spec.endYear; year++) {
    let amount = 0;
    if (spec.mode === "fixed") {
      amount = spec.inflationAdjust
        ? spec.amount * Math.pow(1 + cpi, year - spec.startYear)
        : spec.amount;
    }
    events.push({
      year,
      accountId: spec.accountId,
      charityId: spec.charityId,
      mode: spec.mode,
      amount,
      sourceGiftId: spec.sourceGiftId,
      seriesId: spec.seriesId,
    });
  }
  return events;
}

export interface QcdAccountState {
  /** null: entity-owned, or owned by a non-principal heir, so QCDs from it stop. */
  giver: "client" | "spouse" | null;
  /** isTraditionalIra(acct): traditional, SEP or SIMPLE IRA, inherited included. */
  isSourceType: boolean;
  /** isInheritedIra(acct). */
  inherited: boolean;
  /** false: a SEP/SIMPLE with an employer savings rule into it this year. */
  qualifiesThisYear: boolean;
  /** This year's required minimum (inherited: payout total minus planned extra). */
  requiredMinimum: number;
  /** max(0, balance − Roth slice − own basis): the pre-tax money a QCD can use. */
  available: number;
}

export interface AllocateQcdsInput {
  /** This year's QCDs, in entry order. */
  qcds: QcdEvent[];
  /** Every RMD account plus every QCD source. */
  accounts: ReadonlyMap<string, QcdAccountState>;
  /** Alive this year AND year >= qcdEligibleFromYear(dob). */
  giverEligible: { client: boolean; spouse: boolean };
  charityQualifies: (charityId: string) => boolean;
  cap: number;
}

export interface QcdAllocation {
  results: QcdYearResult[];
  /** Keyed by every account in `accounts` with requiredMinimum > 0. */
  rmdRemaining: Map<string, number>;
  qcdOutByAccount: Map<string, { qualifying: number; taxedExcess: number }>;
}

/** Decide this year's QCDs, in entry order, against each IRA's pre-tax balance
 *  and each giver's cap, then net them against the RMDs they satisfy. A Full
 *  RMD QCD asks for the part of its IRA's RMD not already paid by earlier QCDs
 *  from that IRA this year: 0 once it is covered, and nothing more after a
 *  cap-limited Full RMD QCD (the rest is a normal taxable RMD). */
export function allocateQcds(input: AllocateQcdsInput): QcdAllocation {
  const { accounts, giverEligible, charityQualifies, cap } = input;
  const usedCap = { client: 0, spouse: 0 };
  const results: QcdYearResult[] = [];
  const qcdOutByAccount = new Map<string, { qualifying: number; taxedExcess: number }>();
  const paidOut = (id: string) => {
    const out = qcdOutByAccount.get(id);
    return out ? out.qualifying + out.taxedExcess : 0;
  };

  for (const q of input.qcds) {
    const a = accounts.get(q.accountId);
    if (!a || !a.isSourceType || a.giver == null || !giverEligible[a.giver]) continue;
    const room = a.available - paidOut(q.accountId);
    if (room <= 0) continue;
    // Full RMD takes only the part of this IRA's RMD that earlier QCDs from it
    // this year left unpaid, so a second one never doubles the gift.
    const asked =
      q.mode === "full_rmd"
        ? Math.max(0, a.requiredMinimum - paidOut(q.accountId))
        : q.amount;
    const wanted = Math.min(room, asked);
    if (wanted <= 0) continue;
    // Over the cap, to a non-qualifying charity, or from a SEP/SIMPLE in a
    // contribution year: a fixed gift still goes in full, taxed; a full-RMD
    // gift stops, and the rest of the RMD is paid to the household as usual.
    const capRoom =
      a.qualifiesThisYear && charityQualifies(q.charityId)
        ? Math.max(0, cap - usedCap[a.giver])
        : 0;
    const qualifying = Math.min(wanted, capRoom);
    const taxedExcess = q.mode === "full_rmd" ? 0 : wanted - qualifying;
    if (qualifying + taxedExcess <= 0) continue;

    usedCap[a.giver] += qualifying;
    const out = qcdOutByAccount.get(q.accountId);
    qcdOutByAccount.set(q.accountId, {
      qualifying: (out?.qualifying ?? 0) + qualifying,
      taxedExcess: (out?.taxedExcess ?? 0) + taxedExcess,
    });
    results.push({
      accountId: q.accountId,
      charityId: q.charityId,
      giver: a.giver,
      sourceGiftId: q.sourceGiftId,
      seriesId: q.seriesId,
      qualifying,
      taxedExcess,
    });
  }

  const rmdRemaining = new Map<string, number>();
  for (const [id, a] of accounts) {
    if (a.requiredMinimum > 0) {
      rmdRemaining.set(id, Math.max(0, a.requiredMinimum - paidOut(id)));
    }
  }

  // Treas. Reg. §1.408-8 Q&A-9: one owner's IRA RMDs are totaled and may come
  // from any of their IRAs, so a QCD beyond its own IRA's RMD covers the
  // owner's other IRAs. Inherited IRAs and workplace plans stay out of the pool.
  for (const giver of ["client", "spouse"] as const) {
    const pooled = [...accounts].filter(
      ([, a]) => a.giver === giver && a.isSourceType && !a.inherited,
    );
    let surplus = pooled.reduce(
      (sum, [id, a]) => sum + Math.max(0, paidOut(id) - a.requiredMinimum),
      0,
    );
    for (const [id] of pooled) {
      if (surplus <= 0) break;
      const remaining = rmdRemaining.get(id) ?? 0;
      if (remaining <= 0) continue;
      const off = Math.min(remaining, surplus);
      rmdRemaining.set(id, remaining - off);
      surplus -= off;
    }
  }

  return { results, rmdRemaining, qcdOutByAccount };
}
