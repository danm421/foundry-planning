import type { IntakePayload } from "@/lib/intake/schema";
import {
  beneficiaryName,
  goalSpanLabel,
  goalTopicLabel,
  goalTypeLabel,
} from "@/lib/intake/goal-rows";
import { incomeSpanLabel } from "@/lib/intake/income-years";

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

/** The "On your radar" answers — checked topics plus the free-text note. */
export interface RadarDiff {
  /** Already resolved to the client-facing labels. */
  topics: string[];
  note: string | undefined;
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
  /** Funded goals — apply writes one goal-flagged expense row per entry. */
  expenseGoals: ListSectionDiff;
  radar: RadarDiff;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function field<T>(oldVal: T, newVal: T): FieldDiff<T> {
  if (oldVal === newVal) return { changed: false, value: newVal };
  return { changed: true, old: oldVal, new: newVal };
}

/**
 * "mortgage $420,000 @ 6.5% · 22yr · $2,650/mo" — every field the client gave,
 * dropped from the string when they didn't. Bare "mortgage" means they ticked
 * the box and filled in nothing.
 */
function mortgageSummary(m: NonNullable<IntakePayload["property"][number]["mortgage"]>): string {
  const head = m.balance === undefined ? "mortgage" : `mortgage $${m.balance.toLocaleString()}`;
  const parts = [
    m.interestRatePct === undefined ? undefined : `@ ${m.interestRatePct}%`,
    m.yearsRemaining === undefined ? undefined : `${m.yearsRemaining}yr`,
    m.monthlyPayment === undefined
      ? undefined
      : `$${m.monthlyPayment.toLocaleString()}/mo`,
  ].filter(Boolean);
  return [head, ...parts].join(" · ");
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
  // Optional since the form may not have collected a Family step at all
  // (an existing-client docs-only send). The FieldRows below then render "—"
  // for every family field, which is the honest answer: nothing was asked.
  const sf = submitted.family;
  // Matches the clock apply reads when it fills a blank start year.
  const currentYear = new Date().getFullYear();

  const family: FamilyDiff = {
    primaryName: field(fullName(bf?.primary), fullName(sf?.primary)),
    primaryDob: field(bf?.primary?.dateOfBirth, sf?.primary?.dateOfBirth),
    primaryMarital: field(bf?.primary?.maritalStatus, sf?.primary?.maritalStatus),
    spouseName: field(fullName(bf?.spouse), fullName(sf?.spouse)),
    spouseDob: field(bf?.spouse?.dateOfBirth, sf?.spouse?.dateOfBirth),
    stateOfResidence: field(bf?.stateOfResidence, sf?.stateOfResidence),
    childrenCount: field(bf?.children?.length, sf?.children?.length),
  };

  const goals: GoalsDiff = {
    clientRetirementAge: field(baseline?.goals.clientRetirementAge, submitted.goals.clientRetirementAge),
    spouseRetirementAge: field(baseline?.goals.spouseRetirementAge, submitted.goals.spouseRetirementAge),
    annualRetirementExpenses: field(baseline?.goals.annualRetirementExpenses, submitted.goals.annualRetirementExpenses),
  };

  // The goal's TYPE, span, and beneficiary all ride in `secondary`: apply turns
  // each entry into an expense row whose DB type, year window, and
  // `forFamilyMemberId` come straight from them, so the advisor has to see all
  // three before approving. The value shown is one year's cost — the same figure
  // the client typed and the same one that lands in `annual_amount` — with the
  // span alongside it saying how many years it repeats for.
  //
  // Type, span, and beneficiary all go through the shared helpers, so what the
  // advisor approves is word-for-word what the client picked and exactly the
  // window apply will write.
  const expenseGoals: ListSectionDiff = {
    baselineCount: baseline?.goals.expenseGoals.length ?? 0,
    submittedCount: submitted.goals.expenseGoals.length,
    submittedItems: submitted.goals.expenseGoals.map((g) => {
      const forName = beneficiaryName(g.forWhom, submitted.family);
      return {
        name: g.name,
        value: g.amount,
        secondary: [
          goalTypeLabel(g.type),
          forName ? `for ${forName}` : undefined,
          goalSpanLabel(g, currentYear),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }),
  };

  // Topics resolve to labels here rather than in the view: the CRM note apply
  // writes uses the same `goalTopicLabel`, so what the advisor reads on the
  // review screen is word-for-word what lands on the household timeline.
  const radar: RadarDiff = {
    topics: submitted.goals.topics.map(goalTopicLabel),
    note: submitted.goals.topicsNote?.trim() || undefined,
  };

  // Owner and basis ride along in `secondary`: apply writes both (account_owners
  // rows and the basis column), so the advisor has to see them before approving.
  const accounts: ListSectionDiff = {
    baselineCount: baseline?.accounts.length ?? 0,
    submittedCount: submitted.accounts.length,
    submittedItems: submitted.accounts.map((a) => ({
      name: a.name,
      value: a.value,
      secondary: [
        a.category,
        a.owner,
        a.basis === undefined ? undefined : `basis $${a.basis.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  };

  // Owner and the year window ride along here too: apply writes all three onto
  // the income row, so the advisor has to see whose income it is and how long it
  // runs before approving. A blank year shows as the default apply will use, and
  // "ends at retirement" shows as the anchor rather than a year, because that is
  // what gets stored — an `endYearRef` that follows the retirement age.
  const income: ListSectionDiff = {
    baselineCount: baseline?.income.length ?? 0,
    submittedCount: submitted.income.length,
    submittedItems: submitted.income.map((i) => ({
      name: i.name,
      value: i.annualAmount,
      secondary: [i.type, i.owner, incomeSpanLabel(i, currentYear)].join(" · "),
    })),
  };

  // A property row fans out to three tables on apply — the account, an
  // insurance expense, and a mortgage liability — so everything that drives one
  // of those writes has to be visible before the advisor approves. A declared
  // mortgage shows even with no balance, because that's a fact about the
  // household the advisor should chase down even though apply can't act on it.
  const property: ListSectionDiff = {
    baselineCount: baseline?.property.length ?? 0,
    submittedCount: submitted.property.length,
    submittedItems: submitted.property.map((p) => ({
      name: p.name,
      value: p.value,
      secondary: [
        p.kind,
        p.owner,
        p.basis === undefined ? undefined : `basis $${p.basis.toLocaleString()}`,
        p.annualPropertyTax === undefined
          ? undefined
          : `tax $${p.annualPropertyTax.toLocaleString()}/yr`,
        p.annualInsurance === undefined
          ? undefined
          : `insurance $${p.annualInsurance.toLocaleString()}/yr`,
        p.mortgage === undefined ? undefined : mortgageSummary(p.mortgage),
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  };

  return { family, goals, accounts, income, property, expenseGoals, radar };
}
