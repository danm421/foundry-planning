import { birthYearFromDob, yearForAge } from "@/lib/age-year";
import type { ImportPayload } from "../types";
import type { AssembleGoals, EducationGoal, PlanBasicsField } from "./types";

/** Conventions, not findings. Single call site each, and the chips say so. */
export const EDUCATION_DEFAULT_YEARS = 4;
export const EDUCATION_DEFAULT_GROWTH = 0.05;
export const EDUCATION_START_AGE = 18;

export interface DeriveGoalsInput {
  payload: ImportPayload;
}

function blank<T>(): PlanBasicsField<T> {
  return { value: null, provenance: "derived" };
}

/** Deterministic id from the funding account name — no Math.random. */
function goalId(accountName: string): string {
  return `edu:${accountName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** Reason stamped on the sole-dependent fallback — an inference by elimination, not a document match. */
const SOLE_DEPENDENT_REASON = "Only dependent on file.";

interface StudentMatch {
  firstName: string;
  dateOfBirth?: string;
  /** How the match was made — see `matchStudent` doc. */
  provenance: "document" | "derived";
  /** Set (and required by `PlanBasicsField`) when `provenance` is "derived". */
  reason?: string;
}

/**
 * The student a 529 funds. Extraction captures no beneficiary field at all, so
 * this is a proposal from the account name, always shown and always editable:
 *   1. a dependent whose first name appears in the account name — a real
 *      document signal, `provenance: "document"`, else
 *   2. the sole dependent, when there is exactly one and no name matched —
 *      an inference by elimination, NOT something the document actually
 *      says (a grandchild's 529, a step-relationship could be wrong), so
 *      `provenance: "derived"` with an honest reason, else
 *   3. blank — the advisor picks.
 * Guessing among several unnamed dependents would attach a goal to the wrong
 * child, which is worse than asking.
 */
function matchStudent(
  accountName: string,
  dependents: ImportPayload["dependents"],
): StudentMatch | null {
  const haystack = accountName.toLowerCase();
  const named = dependents.find(
    (d) => d.firstName && d.firstName.length >= 2 && haystack.includes(d.firstName.toLowerCase()),
  );
  if (named) {
    return { firstName: named.firstName, dateOfBirth: named.dateOfBirth, provenance: "document" };
  }
  if (dependents.length === 1 && dependents[0].firstName) {
    return {
      firstName: dependents[0].firstName,
      dateOfBirth: dependents[0].dateOfBirth,
      provenance: "derived",
      reason: SOLE_DEPENDENT_REASON,
    };
  }
  return null;
}

/** Builds a `name`/`forFamilyMemberName`-shaped field carrying the match's real provenance. */
function studentField(student: StudentMatch, value: string): PlanBasicsField<string> {
  return student.provenance === "derived"
    ? { value, provenance: "derived", reason: student.reason ?? SOLE_DEPENDENT_REASON }
    : { value, provenance: "document" };
}

/**
 * Derive goals from evidence. Pure and deterministic — no Date.now, no
 * Math.random, no IO.
 *
 * An education goal is proposed ONLY when a 529 is present in the import. A
 * dependent's birth date is not evidence of a college goal; proposing one from
 * a birthday would invent an intent.
 *
 * The annual cost is always blank: no cost-of-attendance data exists in this
 * system (`institutionState` / `institutionName` are free text, "no cost-lookup
 * DB in v1"). Evidence supplies who, when, and what funds it; the advisor
 * supplies the number.
 */
export function deriveGoals(input: DeriveGoalsInput): AssembleGoals {
  const { payload } = input;

  // De-dupe ids within this pass — two 529s that slugify identically (e.g. two
  // generic "529 Plan" rows) must not collide; downstream (Tasks 8/10/11)
  // indexes by `id` for React keys and commit-time lookup. Indexed by payload
  // order, never Math.random, so it stays deterministic.
  const idOccurrences = new Map<string, number>();

  const education: EducationGoal[] = payload.accounts
    .filter((a) => a.subType === "529")
    .map((account) => {
      const student = matchStudent(account.name ?? "", payload.dependents);
      const birthYear = birthYearFromDob(student?.dateOfBirth);
      const startYear = yearForAge(birthYear, EDUCATION_START_AGE);

      const baseId = goalId(account.name ?? "529");
      const occurrence = (idOccurrences.get(baseId) ?? 0) + 1;
      idOccurrences.set(baseId, occurrence);

      return {
        id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
        name: student
          ? studentField(student, `${student.firstName} — College`)
          : {
              value: "Education Goal",
              provenance: "derived",
              reason: "Named generically; no student identified on the account.",
            },
        forFamilyMemberName: student ? studentField(student, student.firstName) : blank<string>(),
        annualAmount: blank<number>(),
        startYear:
          startYear != null
            ? {
                value: startYear,
                provenance: "derived" as const,
                reason: `First year of college at age ${EDUCATION_START_AGE}, from ${student!.firstName}'s ${birthYear} birth year.`,
              }
            : blank<number>(),
        years: {
          value: EDUCATION_DEFAULT_YEARS,
          provenance: "derived",
          reason: `Assumes a ${EDUCATION_DEFAULT_YEARS}-year programme.`,
        },
        growthRate: {
          value: EDUCATION_DEFAULT_GROWTH,
          provenance: "derived",
          reason: `Tuition inflation assumed at ${(EDUCATION_DEFAULT_GROWTH * 100).toFixed(0)}% a year.`,
        },
        payShortfallOutOfPocket: { value: false, provenance: "derived", reason: "Any cost the 529 cannot cover is left as an unfunded shortfall until you say otherwise." },
        dedicatedAccountNames: account.name ? [account.name] : [],
      } satisfies EducationGoal;
    });

  // Nothing in a document implies a future purchase. Home purchases are added
  // by the advisor in the wizard, never proposed here.
  return { education, homePurchases: [] };
}

/** All-empty goals, for an import assembled before this feature existed. */
export function emptyGoals(): AssembleGoals {
  return { education: [], homePurchases: [] };
}
