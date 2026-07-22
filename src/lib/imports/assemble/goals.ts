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

/**
 * The student a 529 funds. Extraction captures no beneficiary field at all, so
 * this is a proposal from the account name, always shown and always editable:
 *   1. a dependent whose first name appears in the account name, else
 *   2. the sole dependent, if there is exactly one, else
 *   3. blank — the advisor picks.
 * Guessing among several unnamed dependents would attach a goal to the wrong
 * child, which is worse than asking.
 */
function matchStudent(
  accountName: string,
  dependents: ImportPayload["dependents"],
): { firstName: string; dateOfBirth?: string } | null {
  const haystack = accountName.toLowerCase();
  const named = dependents.find(
    (d) => d.firstName && d.firstName.length >= 2 && haystack.includes(d.firstName.toLowerCase()),
  );
  if (named) return { firstName: named.firstName, dateOfBirth: named.dateOfBirth };
  if (dependents.length === 1 && dependents[0].firstName) {
    return { firstName: dependents[0].firstName, dateOfBirth: dependents[0].dateOfBirth };
  }
  return null;
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

  const education: EducationGoal[] = payload.accounts
    .filter((a) => a.subType === "529")
    .map((account) => {
      const student = matchStudent(account.name ?? "", payload.dependents);
      const birthYear = birthYearFromDob(student?.dateOfBirth);
      const startYear = yearForAge(birthYear, EDUCATION_START_AGE);

      return {
        id: goalId(account.name ?? "529"),
        name: {
          value: student ? `${student.firstName} — College` : "Education Goal",
          provenance: student ? "document" : "derived",
          ...(student ? {} : { reason: "Named generically; no student identified on the account." }),
        },
        forFamilyMemberName: student
          ? { value: student.firstName, provenance: "document" as const }
          : blank<string>(),
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
