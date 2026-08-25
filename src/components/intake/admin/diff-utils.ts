import type { IntakePayload } from "@/lib/intake/schema";
import { intakeAccountTypeLabel } from "@/lib/intake/account-types";
import {
  beneficiaryName,
  goalSpanLabel,
  goalTopicLabel,
  goalTypeLabel,
} from "@/lib/intake/goal-rows";
import { incomeSpanLabel } from "@/lib/intake/income-years";
import {
  FIDUCIARY_SLOTS,
  childDistributionLabel,
  estateHouseholdFromPayload,
  fiduciaryContactLine,
  fiduciarySlotLabel,
  findContact,
  findFiduciary,
  formatEstateAddress,
  legalResidenceLabel,
} from "@/lib/intake/estate";
import { RTQ_V1, scoreRtq } from "@/lib/risk/rtq";
import { band } from "@/lib/risk/scoring";
// RiskLevel lives in risk-levels, NOT risk/labels — that module holds
// tolerance-source and binding-constraint labels, not level names.
import type { RiskLevel } from "@/lib/risk-levels";

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

/**
 * The in-form questionnaire, as the advisor reads it before applying.
 *
 * `score` is null unless EVERY question is answered — `scoreRtq` throws on a
 * gap, and a fragment is not a measurement. That is the same rule apply uses,
 * so the card never promises a score the apply then declines to write.
 */
export interface RiskDiff {
  answered: number;
  total: number;
  score: number | null;
  level: RiskLevel | null;
  answers: { prompt: string; label: string }[];
  note: string | null;
}

/**
 * The Estate answers, resolved to the strings the card renders.
 *
 * Not a FieldDiff set like Family: apply writes the principals' phone, email
 * and address onto the CRM contacts, but the NOMINATIONS have no row to be
 * compared against — there is no fiduciary table. So this reads as "what the
 * client told us", which is what the advisor takes to the attorney.
 */
export interface EstateDiff {
  /** Nothing to render — the card is hidden entirely. */
  answered: boolean;
  principals: { name: string; detail: string }[];
  address: string | null;
  legalResidence: string | null;
  nominations: { role: string; name: string; contact: string | null }[];
  distribution: string | null;
  distributionNote: string | null;
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
  estate: EstateDiff;
  risk: RiskDiff;
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
  // The type shows at the grain the client answered — "Roth IRA", not
  // "retirement" — because apply now writes that as the account's sub_type.
  const accounts: ListSectionDiff = {
    baselineCount: baseline?.accounts.length ?? 0,
    submittedCount: submitted.accounts.length,
    submittedItems: submitted.accounts.map((a) => ({
      name: a.name,
      value: a.value,
      secondary: [
        intakeAccountTypeLabel(a),
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

  // Every question is listed, answered or not — an advisor reading a partial
  // sitting needs to see WHICH ones are missing, not just how many.
  const rawAnswers = (submitted.risk?.answers ?? {}) as Record<string, string>;
  const answered = RTQ_V1.filter((q) => q.options.some((o) => o.value === rawAnswers[q.id]));
  const complete = answered.length === RTQ_V1.length;
  const score = complete ? scoreRtq(rawAnswers) : null;
  const risk: RiskDiff = {
    answered: answered.length,
    total: RTQ_V1.length,
    score,
    level: score === null ? null : band(score),
    answers: RTQ_V1.map((q) => ({
      prompt: q.prompt,
      label: q.options.find((o) => o.value === rawAnswers[q.id])?.label ?? "—",
    })),
    note: submitted.risk?.environmentNote ?? null,
  };

  // Estate. Every string is built by the shared helpers in `lib/intake/estate`,
  // so the advisor's card, the client's own review screen and the CRM note apply
  // files all describe an answer the same way.
  const se = submitted.estate;
  const principalDetail = (c: { mobile?: string; email?: string } | undefined) =>
    [c?.mobile?.trim(), c?.email?.trim()].filter(Boolean).join(" · ");
  const principals = (
    [
      { name: fullName(sf?.primary) ?? "Client", detail: principalDetail(se?.contact?.primary) },
      { name: fullName(sf?.spouse) ?? "Spouse", detail: principalDetail(se?.contact?.spouse) },
    ] as { name: string; detail: string }[]
  ).filter((p) => p.detail !== "");

  const nominations = FIDUCIARY_SLOTS.map((slot) => {
    const name = findFiduciary(se?.fiduciaries, slot)?.name?.trim();
    if (!name) return null;
    return {
      role: fiduciarySlotLabel(slot),
      name,
      contact: fiduciaryContactLine(findContact(se?.fiduciaryContacts, name)),
    };
  }).filter((n): n is { role: string; name: string; contact: string | null } => n !== null);

  const distribution = estateHouseholdFromPayload(submitted.family).hasChildren
    ? childDistributionLabel(se?.childrenDistribution)
    : null;

  const estate: EstateDiff = {
    principals,
    address: formatEstateAddress(se?.residence),
    legalResidence: legalResidenceLabel(se?.residence),
    nominations,
    distribution,
    distributionNote: se?.childrenDistribution?.note?.trim() || null,
    answered: false,
  };
  estate.answered =
    principals.length > 0 ||
    estate.address !== null ||
    estate.legalResidence !== null ||
    nominations.length > 0 ||
    distribution !== null;

  return { family, goals, accounts, income, property, expenseGoals, radar, estate, risk };
}
