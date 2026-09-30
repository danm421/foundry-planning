// Inherited-IRA field rules shared by the account form (client) and the
// accounts write-core (server). Pure — no DB, no React.

const INHERITABLE_IRA_SUBTYPES: ReadonlySet<string> = new Set(["traditional_ira", "roth_ira"]);

export function canBeInheritedIra(category: string, subType: string): boolean {
  return category === "retirement" && INHERITABLE_IRA_SUBTYPES.has(subType);
}

export interface InheritedIraBody {
  inheritedDeathYear: number | null;
  inheritedOwnerBirthYear: number | null;
  inheritedHeirDisabled: boolean;
}

const CLEARED: InheritedIraBody = {
  inheritedDeathYear: null,
  inheritedOwnerBirthYear: null,
  inheritedHeirDisabled: false,
};

/** Server rule check. Returns an advisor-readable message, or null when the
 *  pair is valid or absent. */
export function validateInheritedIraFields(args: {
  category: string;
  subType: string;
  inheritedDeathYear: number | null | undefined;
  inheritedOwnerBirthYear: number | null | undefined;
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
  return null;
}

export interface InheritedIraFormState {
  inherited: boolean;
  deathYear: string;
  ownerBirthYear: string;
  heirDisabled: boolean;
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
  return {
    inheritedDeathYear: toYear(state.deathYear),
    inheritedOwnerBirthYear: toYear(state.ownerBirthYear),
    inheritedHeirDisabled: state.heirDisabled,
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
  return validateInheritedIraFields({ category, subType, ...fields, currentYear });
}

/** Row/initial hydration: one place that turns an account's optional fields
 *  into the form's shape. Every producer of an edit-dialog `initial` spreads
 *  this, so no path can drop the fields and let an autosave un-inherit. */
export function inheritedIraRowFields(a: {
  inheritedDeathYear?: number | null;
  inheritedOwnerBirthYear?: number | null;
  inheritedHeirDisabled?: boolean | null;
}): InheritedIraBody {
  return {
    inheritedDeathYear: a.inheritedDeathYear ?? null,
    inheritedOwnerBirthYear: a.inheritedOwnerBirthYear ?? null,
    inheritedHeirDisabled: a.inheritedHeirDisabled === true,
  };
}
