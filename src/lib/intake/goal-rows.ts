/**
 * What an intake goal row MEANS — its wording, its year window, the DB expense
 * type it becomes, and who it's for.
 *
 * The sibling of `income-years.ts`, and for the same reason: four surfaces read
 * these rows (the Goals step's collapsed row, the client's review screen, the
 * advisor's review diff, and `apply`), and every one of them has to agree about
 * the span, or the client is shown one set of years, the advisor approves a
 * second, and a third is written. Keeping the derivations here rather than at
 * each call site is what makes that impossible — and it keeps them testable in
 * plain vitest, away from the transaction.
 */

import {
  INTAKE_GOAL_TOPICS,
  INTAKE_GOAL_TYPES,
  type IntakeGoalTopic,
  type IntakeGoalType,
  type IntakePayload,
} from "@/lib/intake/schema";

export { BENEFICIARY_REF_RE } from "@/lib/intake/schema";

// ── Wording ──────────────────────────────────────────────────────────────────
//
// Both label tables are `Record`s keyed by the schema's own enum and both option
// lists are DERIVED from it, so adding a member to either constant is a type
// error until it's given wording — a hand-written list would just silently omit
// the new one from the `<select>`.

const TYPE_LABELS: Record<IntakeGoalType, string> = {
  education: "Education",
  wedding: "Wedding",
  home: "Home purchase",
  vehicle: "Vehicle",
  travel: "Travel",
  gift: "Gift or family support",
  other: "Something else",
};

const TOPIC_LABELS: Record<IntakeGoalTopic, string> = {
  home: "Buying a home or second home",
  education: "Paying for education",
  wedding: "A wedding",
  travel: "Major travel or a sabbatical",
  business: "Starting, buying, or selling a business",
  family_support: "Helping family — parents, children, grandchildren",
  charitable: "Charitable giving",
  legacy: "Leaving an inheritance",
  care: "Long-term care, for us or a parent",
  relocate: "Relocating or a move in retirement",
  career: "A career change or working part-time",
  debt: "Paying off debt",
};

export const GOAL_TYPE_OPTIONS: readonly { value: IntakeGoalType; label: string }[] =
  INTAKE_GOAL_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }));

export const GOAL_TOPIC_OPTIONS: readonly { value: IntakeGoalTopic; label: string }[] =
  INTAKE_GOAL_TOPICS.map((value) => ({ value, label: TOPIC_LABELS[value] }));

/** The blank template's type, and the fallback everywhere a type is missing. */
export const DEFAULT_GOAL_TYPE: IntakeGoalType = "other";

export function goalTypeLabel(type: IntakeGoalType | undefined): string {
  return TYPE_LABELS[type ?? DEFAULT_GOAL_TYPE];
}

/**
 * Label for a stored topic. Falls back to the raw value rather than dropping it:
 * a topic saved against a since-changed list is still something the client told
 * us, and showing the slug is better than silently losing it on the advisor's
 * review screen.
 */
export function goalTopicLabel(topic: string): string {
  return TOPIC_LABELS[topic as IntakeGoalTopic] ?? topic;
}

// ── Years ────────────────────────────────────────────────────────────────────

/** The stored fields the year derivations read. Draft and submit rows both fit. */
interface GoalYearFields {
  startYear?: number;
  years?: number;
}

/**
 * The window apply writes. A blank start year means "starting now", and BOTH
 * ENDS ARE INCLUSIVE the way the engine reads an expense
 * (`year >= startYear && year <= endYear`) — so a four-year goal is start + 3,
 * and a one-year goal starts and ends in the same year.
 */
export function goalYearWindow(
  goal: GoalYearFields,
  currentYear: number,
): { startYear: number; endYear: number } {
  const startYear = goal.startYear ?? currentYear;
  return { startYear, endYear: startYear + Math.max(1, goal.years ?? 1) - 1 };
}

/** "2032–2035" for a multi-year goal, "2032" for a one-off. */
export function goalSpanLabel(goal: GoalYearFields, currentYear: number): string {
  const { startYear, endYear } = goalYearWindow(goal, currentYear);
  return endYear > startYear ? `${startYear}–${endYear}` : String(startYear);
}

// ── DB expense type ──────────────────────────────────────────────────────────

/**
 * The form's seven client-facing types collapse to the DB's two relevant ones.
 * Education is the only one that maps across — it's always a goal, and the
 * engine funds it from dedicated accounts (`lib/goals.ts`). Everything else is
 * an "other" expense carrying the `is_goal` flag; the specific flavour survives
 * in the row's name, which is what the client typed.
 */
export function goalExpenseType(type: IntakeGoalType): "education" | "other" {
  return type === "education" ? "education" : "other";
}

// ── Who it's for ─────────────────────────────────────────────────────────────
//
// A STRUCTURAL reference, not a name. The form's children don't exist as
// family_members rows until apply inserts them, so there is no id to pick at
// fill-in time — but a name would break the moment the client goes back to the
// Family step and corrects a spelling, leaving a goal pointing at somebody who
// no longer exists while the picker silently reads "The household".
//
// Encoded as a string because that's what a `<select>` value is. Children are
// keyed by their INDEX in `family.children`, which is exactly how apply matches
// them back (`childIds` is pushed in payload order) — so two children with the
// same name stay distinguishable, and neither side needs a dedup rule.

export type GoalBeneficiaryRef = string;

export function childBeneficiaryRef(index: number): GoalBeneficiaryRef {
  return `child:${index}`;
}

/** The index into `family.children`, or null when the ref names a principal. */
export function childIndexFromRef(ref: string | undefined): number | null {
  const match = ref?.match(/^child:(\d{1,2})$/);
  return match ? Number(match[1]) : null;
}

/**
 * Resolve a ref to the person's first name for display, or undefined when it
 * points at somebody the family no longer lists (a child removed after the goal
 * was entered) — or when the form never collected a Family step at all.
 */
export function beneficiaryName(
  ref: string | undefined,
  family: IntakePayload["family"] | undefined,
): string | undefined {
  if (!ref || !family) return undefined;
  if (ref === "client") return family.primary?.firstName?.trim() || undefined;
  if (ref === "spouse") return family.spouse?.firstName?.trim() || undefined;
  const index = childIndexFromRef(ref);
  if (index === null) return undefined;
  return family.children?.[index]?.firstName?.trim() || undefined;
}
