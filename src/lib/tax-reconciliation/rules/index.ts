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

/** This order sets the "already in line" list and the order of the cards WITHIN a section, both of
 *  which print in it. The sections themselves are ordered by SECTION_ORDER, not by rule order. */
export const RULES: readonly Rule[] = [
  householdRules, wageRules, socialSecurityRules, pensionRules, engineFlowRules, rentalRules,
  businessRules, savingsRules, deductionRules, assumptionRules, spendingRule,
];

/** Deliberately outside RULES: `taxRules` is not a plain `Rule`. It takes the suggestions the other
 *  rules produced so the federal-tax card can name the gaps behind the difference, which is why
 *  `build.ts` runs it last rather than in the loop above. */
export { taxRules } from "./tax";
