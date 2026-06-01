// Pure data transformation: ProjectionYear[] + ClientData -> ClientProfilePageData.
// Framework-free. Drives the cards and tables in the Client Profile page.

import type { ClientData, ClientInfo, Income, ProjectionYear } from "@/engine/types";
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

export function buildClientProfileData(input: BuildClientProfileInput): ClientProfilePageData {
  const { years, clientData, scenarioLabel, clientName, spouseName } = input;
  const ci = clientData.client;
  const firstYear = years[0]?.year ?? new Date().getUTCFullYear();
  const lastYear = years[years.length - 1]?.year ?? firstYear;

  return {
    title: "Client Profile",
    subtitle: scenarioLabel,
    persons: buildPersons(ci, years, clientName, spouseName),
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
    .filter((m) => m.role === "child")
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
  const rows = clientData.incomes.map((inc): ProfileIncomeRow => {
    const active = inc.startYear <= firstYear;
    const lookupYear = Math.max(inc.startYear, firstYear);
    const py = years.find((y) => y.year === lookupYear);
    const amount = py?.income.bySource[inc.id] ?? 0;
    return {
      name: inc.name,
      typeLabel: INCOME_TYPE_LABELS[inc.type] ?? "Other",
      amount,
      active,
      startYear: inc.startYear,
      endYear: inc.endYear >= lastYear ? null : inc.endYear,
    };
  });
  return rows.sort((a, b) => a.startYear - b.startYear || a.name.localeCompare(b.name));
}

// First retirement year = min of client/spouse (dob year + retirementAge).
// Mirrors cash-flow's computeFirstRetirementYear.
function firstRetirementYear(ci: ClientInfo): number | null {
  const candidates: number[] = [];
  const cy = birthYear(ci.dateOfBirth);
  if (cy != null && ci.retirementAge != null) candidates.push(cy + ci.retirementAge);
  const sy = birthYear(ci.spouseDob);
  if (sy != null && ci.spouseRetirementAge != null) candidates.push(sy + ci.spouseRetirementAge);
  return candidates.length ? Math.min(...candidates) : null;
}

function buildExpenses(ci: ClientInfo, years: ProjectionYear[]): ProfileExpenseRow[] {
  const currentPy = years[0];
  const retYear = firstRetirementYear(ci);
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
