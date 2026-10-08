// Pure data transformation: ProjectionYear[] + ClientData -> ClientProfilePageData.
// Framework-free. Drives the cards and tables in the Client Profile page.

import type { ClientData, ClientInfo, Income, ProjectionYear } from "@/engine/types";
import { resolveEntitlementMonth } from "@/engine/socialSecurity/claimAge";
import { endInclusionAndFactor } from "@/engine/retirement-proration";
import { spousalTopUp } from "@/lib/social-security/benefit-entry";
import { exactCurrency } from "@/lib/presentations/format";
import type {
  BuildClientProfileInput,
  ClientProfilePageData,
  ProfileChildCard,
  ProfileExpenseRow,
  ProfileIncomeRow,
  ProfilePersonCard,
} from "./types";
import { CO_CLIENT_LABEL, personLabel } from "@/lib/owner-labels";

const INCOME_TYPE_LABELS: Record<Income["type"], string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  deferred: "Deferred Comp",
  trust: "Trust",
  capital_gains: "Capital Gains",
  other: "Other",
};

type YearExpenses = ProjectionYear["expenses"];

// The engine folds modeled Medicare premiums into `insurance`; the profile
// shows them on their own line, as the Cash Flow report does.
const medicare = (e: YearExpenses): number => e.bySource?.medicarePremiums ?? 0;

// Buckets shown in the expenses table, in render order. Rows that would print
// $0 in both columns are dropped downstream.
const EXPENSE_BUCKETS: { label: string; amount: (e: YearExpenses) => number }[] = [
  { label: "Living", amount: (e) => e.living },
  { label: "Insurance", amount: (e) => e.insurance - medicare(e) },
  { label: "Medicare", amount: medicare },
  { label: "Real Estate", amount: (e) => e.realEstate },
  { label: "Debt Payments", amount: (e) => e.liabilities },
  { label: "Taxes", amount: (e) => e.taxes },
  { label: "Cash Gifts", amount: (e) => e.cashGifts },
  { label: "Discretionary", amount: (e) => e.discretionary },
  { label: "Other", amount: (e) => e.other },
];

function birthYear(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const y = new Date(iso).getUTCFullYear();
  return Number.isFinite(y) ? y : null;
}

// A family member counts as a "child card" by descendant relationship. We can't
// rely on the `role` column alone for children: the family-member form never sets
// it, so UI-entered children land in the DB as role:"other". Match imported data
// (role:"child") too, for completeness.
const CHILD_RELATIONSHIPS = new Set(["child", "stepchild", "grandchild", "great_grandchild"]);

function isChildMember(m: { role?: string | null; relationship?: string | null }): boolean {
  // Household principals are person cards, never child cards — even though their
  // `relationship` column commonly holds the schema default of "child" (some
  // creation paths don't override it). The `role` column is authoritative here.
  if (m.role === "client" || m.role === "spouse") return false;
  return m.role === "child" || (m.relationship != null && CHILD_RELATIONSHIPS.has(m.relationship));
}

export function buildClientProfileData(input: BuildClientProfileInput): ClientProfilePageData {
  const { years, clientData, scenarioLabel, clientName, spouseName, spouseLastName } = input;
  const ci = clientData.client;
  const firstYear = years[0]?.year ?? new Date().getUTCFullYear();
  const lastYear = years[years.length - 1]?.year ?? firstYear;

  // Spouse card shows first + last so a different surname isn't dropped. The
  // engine client only carries the spouse's first name, so the last name is
  // threaded in separately from the CRM contact.
  const spouseFullName = spouseName
    ? `${spouseName}${spouseLastName ? ` ${spouseLastName}` : ""}`.trim()
    : null;

  return {
    title: "Client Profile",
    subtitle: scenarioLabel,
    persons: buildPersons(ci, years, clientName, spouseFullName),
    children: buildChildren(clientData, firstYear),
    ...buildIncome(clientData, firstYear, lastYear),
    expenses: buildExpenses(ci, years),
  };
}

function buildPersons(
  ci: ClientInfo,
  years: ProjectionYear[],
  clientName: string,
  spouseName: string | null,
): ProfilePersonCard[] {
  const ageClient = years[0]?.ages.client ?? null;
  const ageSpouse = years[0]?.ages.spouse ?? null;

  const cards: ProfilePersonCard[] = [];
  cards.push(personCard(clientName, ci.dateOfBirth ?? null, ageClient, ci.retirementAge ?? null, ci.lifeExpectancy ?? ci.planEndAge ?? null));

  const hasSpouse = Boolean(spouseName ?? ci.spouseName) && Boolean(ci.spouseDob);
  if (hasSpouse) {
    cards.push(personCard(
      spouseName ?? ci.spouseName ?? CO_CLIENT_LABEL,
      ci.spouseDob ?? null,
      ageSpouse,
      ci.spouseRetirementAge ?? null,
      ci.spouseLifeExpectancy ?? ci.planEndAge ?? null,
    ));
  }
  return cards;
}

function personCard(
  name: string,
  dob: string | null,
  age: number | null,
  retirementAge: number | null,
  lifeExpectancyAge: number | null,
): ProfilePersonCard {
  const yob = birthYear(dob);
  return {
    name,
    dob,
    age,
    retirementAge,
    retirementYear: yob != null && retirementAge != null ? yob + retirementAge : null,
    lifeExpectancyAge,
    lifeExpectancyYear: yob != null && lifeExpectancyAge != null ? yob + lifeExpectancyAge : null,
  };
}

function buildChildren(clientData: ClientData, currentYear: number): ProfileChildCard[] {
  return (clientData.familyMembers ?? [])
    .filter(isChildMember)
    .map((m) => {
      const yob = birthYear(m.dateOfBirth);
      const name = m.lastName ? `${m.firstName} ${m.lastName}` : m.firstName;
      return { name, dob: m.dateOfBirth ?? null, age: yob != null ? currentYear - yob : null };
    });
}

function buildIncome(
  clientData: ClientData,
  firstYear: number,
  lastYear: number,
): { income: ProfileIncomeRow[]; incomeNotes: string[] } {
  const ci = clientData.client;
  const nameOf = (who: "client" | "spouse") =>
    personLabel(who, { clientName: ci.firstName, spouseName: ci.spouseName ?? null });
  const notes: string[] = [];
  const rows = clientData.incomes.map((inc): ProfileIncomeRow => {
    // Social Security is anchored at plan start, but the benefit doesn't begin
    // until the claim age — so its Start column and amount must reflect the
    // resolved claim year and PIA, not the plan-start anchor (which would show
    // "Active" + $0).
    let startYear = inc.type === "social_security" ? ssClaimYear(inc, ci) ?? inc.startYear : inc.startYear;
    let amount =
      inc.type === "social_security" ? ssAnnualAmount(inc) : enteredAnnualAmount(inc, startYear);
    let typeLabel = INCOME_TYPE_LABELS[inc.type] ?? "Other";

    // A spousal benefit is paid on the OTHER spouse's record, so it never shows
    // in this row's own entry — a co-client with no work record read $0. Add it
    // (the editor preview's figure), name it in the Type column, and explain it
    // in a note. A benefit that is ALL spousal starts when both have filed.
    const topUp = inc.type === "social_security" ? ssSpousalTopUp(inc, clientData) : null;
    if (topUp) {
      const me = inc.owner === "spouse" ? "spouse" : "client";
      const them = me === "client" ? "spouse" : "client";
      const spousal = exactCurrency(topUp.annual);
      if (amount > 0) {
        typeLabel = "Social Security + spousal";
        notes.push(`${nameOf(me)}'s amount includes a ${spousal}/yr spousal top-up on ${nameOf(them)}'s work record, starting in ${topUp.startYear}.`);
      } else {
        typeLabel = "Social Security (spousal)";
        startYear = topUp.startYear;
        notes.push(`${nameOf(me)} draws a spousal benefit of ${spousal}/yr on ${nameOf(them)}'s work record, starting in ${topUp.startYear} once both have filed.`);
      }
      amount += topUp.annual;
    }

    const endYear = effectiveEndYear(inc, ci);
    return {
      name: inc.name,
      typeLabel,
      amount,
      active: startYear <= firstYear,
      startYear,
      endYear: endYear >= lastYear ? null : endYear,
    };
  });
  return {
    income: rows.sort((a, b) => a.startYear - b.startYear || a.name.localeCompare(b.name)),
    incomeNotes: notes,
  };
}

// The spousal top-up a Social Security row draws on the other spouse's record,
// annual, today's dollars — null when there is none. Pairs rows the way the
// engine does (computeIncome: the first SS row of the other owner).
function ssSpousalTopUp(inc: Income, clientData: ClientData): { annual: number; startYear: number } | null {
  if (inc.ssBenefitMode === "no_benefit") return null;
  const otherOwner = inc.owner === "spouse" ? "client" : "spouse";
  const other = clientData.incomes.find(
    (o) => o.id !== inc.id && o.type === "social_security" && o.owner === otherOwner,
  ) ?? null;
  const topUp = spousalTopUp(inc, other, clientData.client);
  if (!topUp || !(topUp.monthly > 0)) return null;
  return { annual: Math.round(topUp.monthly * 12), startYear: topUp.startYear };
}

// The Amount column shows the figure the advisor ENTERED, not the projection's
// cash in the first year. A row anchored to a mid-year retirement is prorated by
// the engine — a pension starting in February pays 11/12 that year, a salary
// ending in February pays 1/12 — and surfacing that slice here made the profile
// look as though a smaller number had been entered. Growth is dropped for the
// same reason: this is the plan's stated input, not a projected value.
function enteredAnnualAmount(inc: Income, startYear: number): number {
  // A schedule-driven row has no single annual figure; its first scheduled year
  // is the closest thing to an entered amount (and is likewise unprorated).
  if (inc.scheduleOverrides) return inc.scheduleOverrides[startYear] ?? inc.annualAmount;
  return inc.annualAmount;
}

// Last calendar year the row actually pays. When the end is anchored to a
// retirement milestone, `inc.endYear` resolves to (retirementYear - 1) — the last
// FULL year — while the engine keeps paying a prorated slice through the
// retirement month itself. Ask the engine's own gate whether that following year
// is still included, so the End column names the year the income really stops
// rather than the one before it.
function effectiveEndYear(inc: Income, ci: ClientInfo): number {
  const next = inc.endYear + 1;
  return endInclusionAndFactor(inc.endYearRef, next, inc.endYear, ci).included ? next : inc.endYear;
}

// First calendar year a Social Security row actually pays: the year of its
// entitlement month, as computeIncome gates it. A claim at 67y 6mo starts paying
// partway through the 67th year, not the next one. Returns null for
// legacy/unresolvable rows so callers fall back to inc.startYear.
function ssClaimYear(inc: Income, ci: ClientInfo): number | null {
  // Mirror the engine's delay gate (income.ts): SS only pays at the claim age
  // when claimingAge is set; otherwise it's treated as a regular income paying
  // from its startYear, so fall back to that.
  if (inc.claimingAge == null) return null;
  return resolveEntitlementMonth(inc, ci)?.year ?? null;
}

// Headline annual SS benefit. For PIA-mode rows show PIA×12 (today's dollars,
// consistent with how the other income rows display their entered amount);
// legacy/manual rows show their entered annual amount. Neither reads the
// projection, which prorates a benefit that starts partway through its claim
// year and would understate the headline.
function ssAnnualAmount(inc: Income): number {
  if (inc.ssBenefitMode === "no_benefit") return 0;
  if (inc.ssBenefitMode === "pia_at_fra" && inc.piaMonthly != null) return inc.piaMonthly * 12;
  return inc.annualAmount;
}

// Last retirement year = max of client/spouse (dob year + retirementAge). The
// "Retirement" expense column should reflect the phase where BOTH primary
// clients have retired — using the later retiree avoids sampling a transition
// year in which the retirement-anchored living expense hasn't started yet
// (which made the column collapse onto "Current" for couples where the spouse
// retires first).
function lastRetirementYear(ci: ClientInfo): number | null {
  const candidates: number[] = [];
  const cy = birthYear(ci.dateOfBirth);
  if (cy != null && ci.retirementAge != null) candidates.push(cy + ci.retirementAge);
  const sy = birthYear(ci.spouseDob);
  if (sy != null && ci.spouseRetirementAge != null) candidates.push(sy + ci.spouseRetirementAge);
  return candidates.length ? Math.max(...candidates) : null;
}

function buildExpenses(ci: ClientInfo, years: ProjectionYear[]): ProfileExpenseRow[] {
  const currentPy = years[0];
  const retYear = lastRetirementYear(ci);
  const retirementPy =
    (retYear != null ? years.find((y) => y.year >= retYear) : undefined) ??
    years[years.length - 1];

  if (!currentPy || !retirementPy) return [];

  const rows: ProfileExpenseRow[] = EXPENSE_BUCKETS.map((b) => ({
    label: b.label,
    current: b.amount(currentPy.expenses),
    retirement: b.amount(retirementPy.expenses),
    isTotal: false,
  })).filter((r) => Math.round(r.current) !== 0 || Math.round(r.retirement) !== 0);

  rows.push({
    label: "Total",
    current: currentPy.expenses.total,
    retirement: retirementPy.expenses.total,
    isTotal: true,
  });
  return rows;
}
