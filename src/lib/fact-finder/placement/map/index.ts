// src/lib/fact-finder/placement/map/index.ts
/**
 * Every section's map, in schema order (D4), and the column that feeds a
 * target's field — where a missing required value's "Fix in fact finder" goes
 * (Task 17). Pure.
 */
import type { TargetKind } from "../../change-set";
import { CASH_MAP, EDU_MAP, RETIREMENT_MAP, TAXABLE_MAP } from "./accounts";
import { ANNUITY_MAP, EQUITY_MAP, NOTES_REC_MAP } from "./accounts-other";
import { BEQUESTS_MAP, ESTATE_DOCS_MAP, FINAL_NOTES_MAP, GIFTS_MAP, TRUSTS_MAP } from "./estate";
import { EXPENSES_MAP, LIVING_ITEMS_MAP, LIVING_MAP, SAVINGS_MAP } from "./expenses-savings";
import { EXTERNAL_MAP, FAMILY_MAP, HOUSEHOLD_MAP, META_MAP, PEOPLE_MAP } from "./household";
import { INCOME_MAP, SALARY_MAP, SS_MAP } from "./income";
import { DISABILITY_MAP, INSURANCE_NOTES_MAP, LIFE_MAP, LTC_MAP } from "./insurance";
import { BUSINESS_MAP, LIAB_MAP, REALESTATE_MAP } from "./real-estate-debts";
import type { SectionMap } from "./types";

export const SECTION_MAPS: readonly SectionMap[] = [
  META_MAP, PEOPLE_MAP, HOUSEHOLD_MAP, FAMILY_MAP, EXTERNAL_MAP,
  CASH_MAP, TAXABLE_MAP, RETIREMENT_MAP, ANNUITY_MAP, EDU_MAP, EQUITY_MAP, NOTES_REC_MAP,
  REALESTATE_MAP, BUSINESS_MAP, LIAB_MAP,
  SALARY_MAP, SS_MAP, INCOME_MAP,
  LIVING_MAP, LIVING_ITEMS_MAP, EXPENSES_MAP, SAVINGS_MAP,
  LIFE_MAP, INSURANCE_NOTES_MAP, DISABILITY_MAP, LTC_MAP,
  ESTATE_DOCS_MAP, TRUSTS_MAP, BEQUESTS_MAP, GIFTS_MAP, FINAL_NOTES_MAP,
];

const BY_SECTION = new Map(SECTION_MAPS.map((map) => [map.sectionId, map]));

export function sectionMapFor(sectionId: string): SectionMap | undefined {
  return BY_SECTION.get(sectionId);
}

/**
 * The column of `sectionId` placed into `${target}.${key}`; the first declared
 * when several are (Term (years) before Matures). A key a column feeds only
 * under some mode (a disability's benefit years, under "…to age / for years")
 * isn't declared, so it has none: its Fix goes to the section.
 */
export function columnFeeding(sectionId: string, target: TargetKind, key: string): string | undefined {
  const placements = BY_SECTION.get(sectionId)?.placements ?? {};
  return Object.keys(placements).find((columnId) => {
    const p = placements[columnId];
    return "to" in p && p.to === `${target}.${key}`;
  });
}
