import type { Rule } from "../types";
import { assumptionRules } from "./assumptions";
import { businessRules } from "./businesses";
import { deductionRules } from "./deductions";
import { engineFlowRules } from "./engine-flows";
import { householdRules } from "./household";
import { pensionRules } from "./pensions";
import { rentalRules } from "./rental";
import { savingsRules } from "./savings";
import { socialSecurityRules } from "./social-security";
import { spendingRule } from "./spending";
import { wageRules } from "./wages";

/** A rule and the plain-words name a note uses when it throws. The label is a literal rather than
 *  `fn.name` for two reasons: a production bundle mangles function names, and the note is written
 *  for the advisor reading the page, not for a stack trace. Each reads as "The ${label} checks". */
export interface NamedRule { label: string; rule: Rule }

/** This order sets the "already in line" list and the order of the cards WITHIN a section, both of
 *  which print in it. The sections themselves are ordered by SECTION_ORDER, not by rule order. */
export const RULES: readonly NamedRule[] = [
  { label: "household", rule: householdRules },
  { label: "wage", rule: wageRules },
  { label: "Social Security", rule: socialSecurityRules },
  { label: "pension", rule: pensionRules },
  { label: "investment and retirement income", rule: engineFlowRules },
  { label: "rental", rule: rentalRules },
  { label: "business", rule: businessRules },
  { label: "savings", rule: savingsRules },
  { label: "deduction", rule: deductionRules },
  { label: "assumption", rule: assumptionRules },
  { label: "spending", rule: spendingRule },
];

/** Deliberately outside RULES: `taxRules` is not a plain `Rule`. It takes the suggestions the other
 *  rules produced so the federal-tax card can name the gaps behind the difference, which is why
 *  `build.ts` runs it last rather than in the loop above. */
export { taxRules } from "./tax";
