import type { IntakePayload } from "@/lib/intake/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldDiff<T = string | number | undefined> =
  | { changed: true; old: T; new: T }
  | { changed: false; value: T };

export interface FamilyDiff {
  primaryName: FieldDiff;
  primaryDob: FieldDiff;
  primaryMarital: FieldDiff;
  spouseName: FieldDiff;
  spouseDob: FieldDiff;
  stateOfResidence: FieldDiff;
  childrenCount: FieldDiff<number | undefined>;
}

export interface GoalsDiff {
  clientRetirementAge: FieldDiff<number | undefined>;
  spouseRetirementAge: FieldDiff<number | undefined>;
  annualRetirementExpenses: FieldDiff<number | undefined>;
}

export interface ListSectionDiff {
  baselineCount: number;
  submittedCount: number;
  submittedItems: { name: string; value?: number; secondary?: string }[];
}

export interface IntakeDiff {
  family: FamilyDiff;
  goals: GoalsDiff;
  accounts: ListSectionDiff;
  income: ListSectionDiff;
  property: ListSectionDiff;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function field<T>(oldVal: T, newVal: T): FieldDiff<T> {
  if (oldVal === newVal) return { changed: false, value: newVal };
  return { changed: true, old: oldVal, new: newVal };
}

function fullName(p: { firstName?: string; lastName?: string } | undefined | null): string | undefined {
  if (!p) return undefined;
  const parts = [p.firstName, p.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildIntakeDiff(
  baseline: IntakePayload | null,
  submitted: IntakePayload,
): IntakeDiff {
  const bf = baseline?.family;
  const sf = submitted.family;

  const family: FamilyDiff = {
    primaryName: field(fullName(bf?.primary), fullName(sf.primary)),
    primaryDob: field(bf?.primary?.dateOfBirth, sf.primary.dateOfBirth),
    primaryMarital: field(bf?.primary?.maritalStatus, sf.primary.maritalStatus),
    spouseName: field(fullName(bf?.spouse ?? undefined), fullName(sf.spouse ?? undefined)),
    spouseDob: field(bf?.spouse?.dateOfBirth, sf.spouse?.dateOfBirth),
    stateOfResidence: field(bf?.stateOfResidence, sf.stateOfResidence),
    childrenCount: field(bf?.children?.length, sf.children.length),
  };

  const goals: GoalsDiff = {
    clientRetirementAge: field(baseline?.goals.clientRetirementAge, submitted.goals.clientRetirementAge),
    spouseRetirementAge: field(baseline?.goals.spouseRetirementAge, submitted.goals.spouseRetirementAge),
    annualRetirementExpenses: field(baseline?.goals.annualRetirementExpenses, submitted.goals.annualRetirementExpenses),
  };

  const accounts: ListSectionDiff = {
    baselineCount: baseline?.accounts.length ?? 0,
    submittedCount: submitted.accounts.length,
    submittedItems: submitted.accounts.map((a) => ({
      name: a.name,
      value: a.value,
      secondary: a.category,
    })),
  };

  const income: ListSectionDiff = {
    baselineCount: baseline?.income.length ?? 0,
    submittedCount: submitted.income.length,
    submittedItems: submitted.income.map((i) => ({
      name: i.name,
      value: i.annualAmount,
      secondary: i.type,
    })),
  };

  const property: ListSectionDiff = {
    baselineCount: baseline?.property.length ?? 0,
    submittedCount: submitted.property.length,
    submittedItems: submitted.property.map((p) => ({
      name: p.name,
      value: p.value,
      secondary: p.kind,
    })),
  };

  return { family, goals, accounts, income, property };
}
