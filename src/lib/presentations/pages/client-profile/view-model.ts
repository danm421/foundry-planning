// Pure data transformation: ProjectionYear[] + ClientData -> ClientProfilePageData.
// Framework-free. Drives the cards and tables in the Client Profile page.

import type { ClientData, ClientInfo, Income, ProjectionYear } from "@/engine/types";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import type {
  BuildClientProfileInput,
  ClientProfilePageData,
  ProfileChildCard,
  ProfileExpenseRow,
  ProfileIncomeRow,
  ProfilePersonCard,
} from "./types";

const INCOME_TYPE_LABELS: Record<Income["type"], string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  deferred: "Deferred Comp",
  trust: "Trust",
  capital_gains: "Capital Gains",
  other: "Other",
};

// Buckets shown in the expenses table, in render order. Keys index
// ProjectionYear.expenses; zero-in-both-columns rows are dropped downstream.
const EXPENSE_BUCKETS: { label: string; key: keyof ProjectionYear["expenses"] }[] = [
  { label: "Living", key: "living" },
  { label: "Insurance", key: "insurance" },
  { label: "Real Estate", key: "realEstate" },
  { label: "Debt Payments", key: "liabilities" },
  { label: "Taxes", key: "taxes" },
  { label: "Cash Gifts", key: "cashGifts" },
  { label: "Discretionary", key: "discretionary" },
  { label: "Other", key: "other" },
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
    income: buildIncome(clientData, years, firstYear, lastYear),
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
      spouseName ?? ci.spouseName ?? "Spouse",
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
  years: ProjectionYear[],
  firstYear: number,
  lastYear: number,
): ProfileIncomeRow[] {
  const ci = clientData.client;
  const rows = clientData.incomes.map((inc): ProfileIncomeRow => {
    // Social Security is anchored at plan start, but the benefit doesn't begin
    // until the claim age — so its Start column and amount must reflect the
    // resolved claim year and PIA, not the plan-start anchor (which would show
    // "Active" + $0).
    const startYear = inc.type === "social_security" ? ssClaimYear(inc, ci) ?? inc.startYear : inc.startYear;
    const amount =
      inc.type === "social_security"
        ? ssAnnualAmount(inc, years, startYear)
        : (years.find((y) => y.year === Math.max(inc.startYear, firstYear))?.income.bySource[inc.id] ?? 0);
    return {
      name: inc.name,
      typeLabel: INCOME_TYPE_LABELS[inc.type] ?? "Other",
      amount,
      active: startYear <= firstYear,
      startYear,
      endYear: inc.endYear >= lastYear ? null : inc.endYear,
    };
  });
  return rows.sort((a, b) => a.startYear - b.startYear || a.name.localeCompare(b.name));
}

// First calendar year a Social Security row actually pays, mirroring the engine's
// claim gate (computeIncome: pays once year*12 >= birthYear*12 + claimAgeMonths).
// Returns null for legacy/unresolvable rows so callers fall back to inc.startYear.
function ssClaimYear(inc: Income, ci: ClientInfo): number | null {
  // Mirror the engine's delay gate (income.ts): SS only pays at the claim age
  // when claimingAge is set; otherwise it's treated as a regular income paying
  // from its startYear, so fall back to that.
  if (inc.claimingAge == null) return null;
  const ownerDob = inc.owner === "spouse" ? ci.spouseDob : ci.dateOfBirth;
  if (!ownerDob) return null;
  const claimAgeMonths = resolveClaimAgeMonths(inc, ci);
  if (claimAgeMonths == null) return null;
  const by = birthYear(ownerDob);
  if (by == null) return null;
  return by + Math.ceil(claimAgeMonths / 12);
}

// Headline annual SS benefit. For PIA-mode rows show PIA×12 (today's dollars,
// consistent with how the other income rows display their entered amount). Fall
// back to the projection at the claim year for legacy/manual rows.
function ssAnnualAmount(inc: Income, years: ProjectionYear[], startYear: number): number {
  if (inc.ssBenefitMode === "no_benefit") return 0;
  if (inc.ssBenefitMode === "pia_at_fra" && inc.piaMonthly != null) return inc.piaMonthly * 12;
  return years.find((y) => y.year === startYear)?.income.bySource[inc.id] ?? inc.annualAmount;
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
    current: currentPy.expenses[b.key] as number,
    retirement: retirementPy.expenses[b.key] as number,
    isTotal: false,
  })).filter((r) => r.current !== 0 || r.retirement !== 0);

  rows.push({
    label: "Total",
    current: currentPy.expenses.total,
    retirement: retirementPy.expenses.total,
    isTotal: true,
  });
  return rows;
}
