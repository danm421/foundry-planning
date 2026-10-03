// Inherited-IRA field rules shared by the account form (client) and the
// accounts write-core (server). Pure — no DB, no React.

import { resolveInheritedRule } from "@/engine/inherited-ira";

const INHERITABLE_IRA_SUBTYPES: ReadonlySet<string> = new Set(["traditional_ira", "roth_ira"]);

export function canBeInheritedIra(category: string, subType: string): boolean {
  return category === "retirement" && INHERITABLE_IRA_SUBTYPES.has(subType);
}

export interface InheritedIraBody {
  inheritedDeathYear: number | null;
  inheritedOwnerBirthYear: number | null;
  inheritedHeirDisabled: boolean;
  /** Even-payout window (spec 2026-10-03). Both null ⇒ minimum each year. */
  inheritedPayoutFromYear: number | null;
  inheritedPayoutThroughYear: number | null;
}

const CLEARED: InheritedIraBody = {
  inheritedDeathYear: null,
  inheritedOwnerBirthYear: null,
  inheritedHeirDisabled: false,
  inheritedPayoutFromYear: null,
  inheritedPayoutThroughYear: null,
};

/** Server rule check. Returns an advisor-readable message, or null when the
 *  pair is valid or absent. */
export function validateInheritedIraFields(args: {
  category: string;
  subType: string;
  inheritedDeathYear: number | null | undefined;
  inheritedOwnerBirthYear: number | null | undefined;
  inheritedPayoutFromYear?: number | null;
  inheritedPayoutThroughYear?: number | null;
  currentYear: number;
}): string | null {
  const death = args.inheritedDeathYear ?? null;
  const ownerBirth = args.inheritedOwnerBirthYear ?? null;
  if (death == null && ownerBirth == null) return null;
  if (death == null || ownerBirth == null) {
    return "An inherited IRA needs both the year of death and the original owner's birth year.";
  }
  if (!canBeInheritedIra(args.category, args.subType)) return "Only a Traditional or Roth IRA can be marked inherited.";
  if (!Number.isInteger(death) || !Number.isInteger(ownerBirth)) return "Years must be whole numbers.";
  if (ownerBirth < 1900) return "The original owner's birth year must be 1900 or later.";
  if (death <= ownerBirth) return "The year of death must be after the original owner's birth year.";
  if (death - ownerBirth > 120) return "The original owner can't have been older than 120 at death.";
  if (death > args.currentYear) return `The year of death can't be later than ${args.currentYear}.`;
  return validateInheritedPayoutWindow(
    death,
    args.inheritedPayoutFromYear ?? null,
    args.inheritedPayoutThroughYear ?? null,
  );
}

/** Payout-window rules on a valid inherited IRA; null when valid or absent.
 *  The 10-year deadline is the form's check alone (`inheritedPayoutFormError`):
 *  it needs the heir's birth year, and the engine clamps a later year anyway. */
function validateInheritedPayoutWindow(
  deathYear: number,
  fromYear: number | null,
  throughYear: number | null,
): string | null {
  if (fromYear == null && throughYear == null) return null;
  if (fromYear == null || throughYear == null) return "Enter the first and last payout years.";
  if (!Number.isInteger(fromYear) || !Number.isInteger(throughYear)) return "Payout years must be whole numbers.";
  if (fromYear <= deathYear) return `Payouts can start no earlier than ${deathYear + 1}, the year after death.`;
  if (throughYear < fromYear) return "The last payout year can't be before the first.";
  return null;
}

export interface InheritedIraFormState {
  inherited: boolean;
  deathYear: string;
  ownerBirthYear: string;
  heirDisabled: boolean;
  /** "even" sends the typed window; absent or "minimum" sends nulls. */
  payoutPlan?: "minimum" | "even";
  payoutFromYear?: string;
  payoutThroughYear?: string;
}

/** The account-body slice for the three inherited fields. Unticking the box, or
 *  switching to a type that can't be inherited, writes nulls so no stale year
 *  survives on the row. */
export function inheritedIraBodyFields(
  state: InheritedIraFormState,
  category: string,
  subType: string,
): InheritedIraBody {
  if (!state.inherited || !canBeInheritedIra(category, subType)) return { ...CLEARED };
  const toYear = (s: string): number | null => (s.trim() === "" ? null : Number(s));
  const even = state.payoutPlan === "even";
  return {
    inheritedDeathYear: toYear(state.deathYear),
    inheritedOwnerBirthYear: toYear(state.ownerBirthYear),
    inheritedHeirDisabled: state.heirDisabled,
    inheritedPayoutFromYear: even ? toYear(state.payoutFromYear ?? "") : null,
    inheritedPayoutThroughYear: even ? toYear(state.payoutThroughYear ?? "") : null,
  };
}

/** Form-side message: the server rules plus "both years required" while ticked. */
export function inheritedIraFormError(
  state: InheritedIraFormState,
  category: string,
  subType: string,
  currentYear: number,
): string | null {
  if (!state.inherited || !canBeInheritedIra(category, subType)) return null;
  const fields = inheritedIraBodyFields(state, category, subType);
  if (fields.inheritedDeathYear == null || fields.inheritedOwnerBirthYear == null) {
    return "Enter the year of death and the original owner's birth year.";
  }
  // The year pair only. The window's errors come from inheritedPayoutFormError
  // and show under the window: an error in THIS slot hides the whole payout
  // section, including the inputs that would fix it.
  return validateInheritedIraFields({
    category,
    subType,
    inheritedDeathYear: fields.inheritedDeathYear,
    inheritedOwnerBirthYear: fields.inheritedOwnerBirthYear,
    currentYear,
  });
}

/** Form-side message for the payout window, shown under the window inputs.
 *  Null unless "Spread payouts evenly" is chosen on a ticked IRA whose year
 *  pair is complete. Adds the 10-year deadline, which the server can't check
 *  without the heir's birth year; a null `heirBirthYear` skips it. */
export function inheritedPayoutFormError(
  state: InheritedIraFormState,
  category: string,
  subType: string,
  heirBirthYear: number | null,
): string | null {
  if (!state.inherited || !canBeInheritedIra(category, subType) || state.payoutPlan !== "even") return null;
  const f = inheritedIraBodyFields(state, category, subType);
  if (f.inheritedDeathYear == null || f.inheritedOwnerBirthYear == null) return null;
  // "Spread evenly" needs its years; the shared check treats both-blank as "no
  // window" (right for the server), which here would silently save "minimum".
  if (f.inheritedPayoutFromYear == null || f.inheritedPayoutThroughYear == null) {
    return "Enter the first and last payout years.";
  }
  const windowError = validateInheritedPayoutWindow(f.inheritedDeathYear, f.inheritedPayoutFromYear, f.inheritedPayoutThroughYear);
  if (windowError != null || heirBirthYear == null) return windowError;
  const rule = resolveInheritedRule({
    deathYear: f.inheritedDeathYear,
    ownerBirthYear: f.inheritedOwnerBirthYear,
    heirBirthYear,
    heirDisabled: state.heirDisabled,
    isRoth: subType === "roth_ira",
  });
  if (rule.finalYear != null && f.inheritedPayoutThroughYear > rule.finalYear) {
    return `The 10-year rule empties this account by ${rule.finalYear}, so the last payout year can't be later.`;
  }
  return null;
}

/** Row/initial hydration: one place that turns an account's optional fields
 *  into the form's shape. Every producer of an edit-dialog `initial` spreads
 *  this, so no path can drop the fields and let an autosave un-inherit. */
export function inheritedIraRowFields(a: {
  inheritedDeathYear?: number | null;
  inheritedOwnerBirthYear?: number | null;
  inheritedHeirDisabled?: boolean | null;
  inheritedPayoutFromYear?: number | null;
  inheritedPayoutThroughYear?: number | null;
}): InheritedIraBody {
  // A window only means something on an inherited IRA, and only whole and in
  // order (as `inheritedPayoutWindowFor` reads it). Dropping anything else here
  // keeps every hydrated row (edit dialog, Solver save-to-base) inside the
  // accounts CHECKs.
  const from = a.inheritedPayoutFromYear;
  const through = a.inheritedPayoutThroughYear;
  const hasWindow =
    a.inheritedDeathYear != null &&
    from != null &&
    through != null &&
    Number.isInteger(from) &&
    Number.isInteger(through) &&
    from <= through;
  return {
    inheritedDeathYear: a.inheritedDeathYear ?? null,
    inheritedOwnerBirthYear: a.inheritedOwnerBirthYear ?? null,
    inheritedHeirDisabled: a.inheritedHeirDisabled === true,
    inheritedPayoutFromYear: hasWindow ? from : null,
    inheritedPayoutThroughYear: hasWindow ? through : null,
  };
}
