// src/lib/fact-finder/enums.ts
/**
 * Option label ↔ app enum value. One table per option list; Plan 3's placement
 * map reads the same tables, so a label is translated in exactly one place.
 */
export type OptionMap = readonly (readonly [label: string, value: string])[];

export function labelFor(map: OptionMap, value: string | null | undefined): string | null {
  return map.find(([, v]) => v === value)?.[0] ?? null;
}

export function valueFor(map: OptionMap, label: string | null | undefined): string | null {
  return map.find(([l]) => l === label)?.[1] ?? null;
}

// accounts.sub_type, per section
export const CASH_TYPE_MAP: OptionMap = [
  ["Checking", "checking"], ["Savings", "savings"], ["CD", "cd"], ["Money market", "money_market"], ["Other", "other"],
];
export const TAXABLE_TYPE_MAP: OptionMap = [["Brokerage", "brokerage"], ["Trust", "trust"], ["Other", "other"]];
export const RETIRE_TYPE_MAP: OptionMap = [
  ["Traditional IRA", "traditional_ira"], ["Roth IRA", "roth_ira"], ["401(k)", "401k"], ["403(b)", "403b"],
  ["401(a)", "401a"], ["SEP IRA", "sep_ira"], ["SIMPLE IRA", "simple_ira"], ["HSA", "hsa"], ["Other", "other"],
];
/** An annuity's sub-type IS its tax treatment (see accountSubTypeEnum). */
export const ANNUITY_TAX_MAP: OptionMap = [
  ["Non-qualified", "non_qualified"], ["Qualified", "qualified"], ["Tax-free", "tax_free"],
];
export const PROPERTY_TYPE_MAP: OptionMap = [
  ["Primary residence", "primary_residence"], ["Rental property", "rental_property"],
  ["Commercial property", "commercial_property"],
];
/** accounts.sub_type for a business. (accounts.business_type is a different enum: BUSINESS_TYPE_MAP.) */
export const BUSINESS_SUBTYPE_MAP: OptionMap = [
  ["Sole proprietorship", "sole_proprietorship"], ["Partnership", "partnership"], ["S-Corp", "s_corp"],
  ["C-Corp", "c_corp"], ["LLC", "llc"], ["Other", "other"],
];
/** accounts.sub_type of a life insurance account. */
export const LIFE_SUBTYPE_MAP: OptionMap = [
  ["Term", "term"], ["Whole life", "whole_life"], ["Universal life", "universal_life"], ["Variable life", "variable_life"],
];
/** life_insurance_policies.policy_type. */
export const LIFE_POLICY_TYPE_MAP: OptionMap = [
  ["Term", "term"], ["Whole life", "whole"], ["Universal life", "universal"], ["Variable life", "variable"],
];

// people
export const OWNER_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Joint", "joint"]];
export const INCOME_OWNER_MAP: OptionMap = OWNER_MAP;
export const PERSON_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"]];
export const INSURED_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Joint (survivorship)", "joint"]];
export const GIFT_FROM_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Joint (split gift)", "joint"]];

// income and expenses
export const INCOME_TYPE_MAP: OptionMap = [
  ["Business", "business"], ["Deferred comp", "deferred"], ["Capital gains", "capital_gains"], ["Trust", "trust"],
  ["Other", "other"],
];
export const EXPENSE_TYPE_MAP: OptionMap = [
  ["Living", "living"], ["Insurance", "insurance"], ["Education", "education"], ["Other", "other"],
];

// household
export const FILING_MAP: OptionMap = [
  ["Single", "single"], ["Married filing jointly", "married_joint"],
  ["Married filing separately", "married_separate"], ["Head of household", "head_of_household"],
];
export const RELATIONSHIP_MAP: OptionMap = [
  ["Child", "child"], ["Stepchild", "stepchild"], ["Grandchild", "grandchild"],
  ["Great-grandchild", "great_grandchild"], ["Parent", "parent"], ["Grandparent", "grandparent"],
  ["Sibling", "sibling"], ["Sibling-in-law", "sibling_in_law"], ["Son/Daughter-in-law", "child_in_law"],
  ["Niece/Nephew", "niece_nephew"], ["Aunt/Uncle", "aunt_uncle"], ["Cousin", "cousin"],
  ["Grand-aunt/uncle", "grand_aunt_uncle"], ["Other", "other"],
];
export const DEPENDENT_MAP: OptionMap = [["Auto", "auto"], ["Yes", "yes"], ["No", "no"]];
export const BENE_KIND_MAP: OptionMap = [["Charity", "charity"], ["Individual", "individual"]];
export const CHARITY_TYPE_MAP: OptionMap = [["Public charity", "public"], ["Private foundation", "private"]];

// accounts
export const TITLING_MAP: OptionMap = [["JTWROS", "jtwros"], ["Community property", "community_property"]];
export const ANNUITY_PRODUCT_MAP: OptionMap = [
  ["SPIA", "spia"], ["DIA", "dia"], ["MYGA", "myga"], ["Fixed", "fixed"], ["Fixed indexed", "fixed_indexed"],
  ["Variable", "variable"], ["QLAC", "qlac"],
];
export const ANNUITY_INCOME_MAP: OptionMap = [
  ["None", "none"], ["Income rider (GLWB)", "rider"], ["Annuitized", "annuitized"],
];
export const ANNUITY_PAYOUT_MAP: OptionMap = [
  ["Single life", "single_life"], ["Joint & survivor", "joint_survivor"],
  ["Life w/ period certain", "life_with_period_certain"], ["Period certain", "period_certain"],
  ["Cash refund", "cash_refund"],
];
export const GRANT_TYPE_MAP: OptionMap = [["RSU", "rsu"], ["NQSO", "nqso"], ["ISO", "iso"]];
export const NOTE_PAY_MAP: OptionMap = [["Amortizing", "amortizing"], ["Interest-only, balloon", "interest_only_balloon"]];

// real estate, business and debts
/** accounts.business_type (≠ BUSINESS_SUBTYPE_MAP, which is accounts.sub_type). */
export const BUSINESS_TYPE_MAP: OptionMap = [
  ["Sole proprietorship", "sole_prop"], ["Partnership", "partnership"], ["S-Corp", "s_corp"],
  ["C-Corp", "c_corp"], ["LLC", "llc"], ["Other", "other"],
];
export const BUSINESS_TAX_MAP: OptionMap = [
  ["QBI (pass-through)", "qbi"], ["Ordinary income", "ordinary"], ["Non-taxable", "non_taxable"],
];
export const LIABILITY_TYPE_MAP: OptionMap = [
  ["Mortgage", "mortgage"], ["HELOC", "heloc"], ["Auto loan", "auto"], ["Student loan", "student"],
  ["Personal loan", "personal"], ["Credit card", "credit_card"], ["Other", "other"],
];

// income
/** incomes.ss_benefit_mode. "estimate_from_salary" is never stored: the Social Security map turns it into pia_at_fra. */
export const SS_SOURCE_MAP: OptionMap = [
  ["Estimate from salary", "estimate_from_salary"], ["Benefit at full retirement age", "pia_at_fra"],
  ["Stated benefit at age", "manual_amount"], ["No benefit", "no_benefit"],
];
export const SS_CLAIM_MAP: OptionMap = [
  ["At full retirement age", "fra"], ["At retirement", "at_retirement"], ["At a specific age", "years"],
];
export const TAX_TYPE_MAP: OptionMap = [
  ["Earned income", "earned_income"], ["Ordinary income", "ordinary_income"], ["Qualified dividends", "dividends"],
  ["Capital gains", "capital_gains"], ["QBI", "qbi"], ["Tax-exempt", "tax_exempt"], ["Short-term gains", "stcg"],
  ["Municipal bond interest", "muni_interest"],
];

// expenses and savings
export const FREQ_MAP: OptionMap = [["Monthly", "monthly"], ["Annually", "annual"]];
/** Not stored: which savings_rule amount the row fills (IRS maximum → contributeMax). */
export const CONTRIB_MAP: OptionMap = [["Fixed $ amount", "amount"], ["% of salary", "percent"], ["IRS maximum", "max"]];

// insurance
export const PAID_BY_MAP: OptionMap = [["Owner", "owner"], ["Client", "client"], ["Co-client", "spouse"], ["Both", "both"]];
export const DI_EARNINGS_MAP: OptionMap = [["Salary", "salary"], ["Stated amount", "manual"]];
export const DI_RUNS_MAP: OptionMap = [
  ["To age", "to_age"], ["To SS normal retirement age", "to_ssnra"], ["For a number of years", "years"],
  ["Lifetime", "lifetime"],
];
export const DI_PAYER_MAP: OptionMap = [["Employer", "employer"], ["Insured", "insured"]];
export const LTC_KIND_MAP: OptionMap = [["Traditional standalone", "standalone"], ["Rider on a life policy", "life_rider"]];
export const LTC_PER_MAP: OptionMap = [["Day", "day"], ["Month", "month"]];
export const LTC_LAST_MAP: OptionMap = [["For a number of years", "years"], ["Lifetime", "lifetime"]];
export const LTC_PAYS_MAP: OptionMap = [
  ["Actual costs (reimbursement)", "reimbursement"], ["Full limit (indemnity)", "indemnity"],
];
export const LTC_INFL_MAP: OptionMap = [["None", "none"], ["Simple", "simple"], ["Compound", "compound"]];
export const LTC_PREM_MAP: OptionMap = [
  ["Lifetime", "lifetime"], ["To age", "to_age"], ["For a number of years", "years"], ["Paid up", "paid_up"],
];

// estate
/** entities.trust_sub_type. "revocable" isn't saved there: it routes the row to revocable_trust. */
export const TRUST_TYPE_MAP: OptionMap = [
  ["Revocable living trust", "revocable"], ["Irrevocable", "irrevocable"], ["ILIT", "ilit"], ["IDGT", "idgt"],
  ["CLT", "clt"], ["CRT", "crt"],
];
/** entities.grantor. "none" saves as null (the app has no "someone else" value). */
export const TRUST_GRANTOR_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Someone else", "none"]];
export const TRUST_ENDS_MAP: OptionMap = [
  ["At client's death", "client_death"], ["At co-client's death", "spouse_death"], ["At second death", "survivorship"],
];
/** will_bequests.kind. "residuary" isn't a bequest: it makes will_residuary_recipient rows. */
export const BEQUEST_KIND_MAP: OptionMap = [
  ["Specific asset", "asset"], ["Remaining estate", "residuary"], ["Debt (who pays)", "liability"],
];
export const BEQUEST_COND_MAP: OptionMap = [
  ["Always", "always"], ["If co-client survives", "if_spouse_survives"],
  ["If co-client predeceases", "if_spouse_predeceased"],
];

/** The accounts.category an account section's rows become. */
export const SECTION_ACCOUNT_CATEGORY = {
  cash: "cash",
  taxable: "taxable",
  retirement: "retirement",
  annuity: "annuity",
  edu: "education_savings",
  realestate: "real_estate",
  business: "business",
} as const;

/**
 * How every choice column is read: an OptionMap (label → stored value), or a
 * special reader — "owner": an Owner column read with its "Which trust /
 * entity" into owner rows (a life policy's owner too); "yesNo": Yes → true;
 * "month": a month name → 1..12; "state": the USPS code is the label;
 * "integer": the label is a whole number; "entityName": the text naming the
 * owning trust or entity, read only while Owner is "Trust / entity".
 */
export type ChoiceReader = OptionMap | "owner" | "yesNo" | "month" | "state" | "integer" | "entityName";

/** `${sectionId}.${columnId}` → its reader. A test proves every choice column is here, with its labels in order. */
export const CHOICE_READERS: Readonly<Record<string, ChoiceReader>> = {
  // household
  "people.retirementMonth": "month",
  "people.coveredByWorkplacePlan": "yesNo",
  "household.filingStatus": FILING_MAP,
  "household.stateOfResidence": "state",
  "household.state": "state",
  "family.relationship": RELATIONSHIP_MAP,
  "family.claimedAsDependent": DEPENDENT_MAP,
  "external.kind": BENE_KIND_MAP,
  "external.charityType": CHARITY_TYPE_MAP,
  // accounts
  "cash.owner": "owner",
  "cash.jointTitling": TITLING_MAP,
  "cash.accountType": CASH_TYPE_MAP,
  "cash.ownerEntity": "entityName",
  "taxable.owner": "owner",
  "taxable.jointTitling": TITLING_MAP,
  "taxable.accountType": TAXABLE_TYPE_MAP,
  "taxable.ownerEntity": "entityName",
  "retirement.owner": "owner",
  "retirement.accountType": RETIRE_TYPE_MAP,
  "retirement.inherited": "yesNo",
  "annuity.owner": "owner",
  "annuity.taxTreatment": ANNUITY_TAX_MAP,
  "annuity.productType": ANNUITY_PRODUCT_MAP,
  "annuity.income": ANNUITY_INCOME_MAP,
  "annuity.payoutStructure": ANNUITY_PAYOUT_MAP,
  "annuity.ownerEntity": "entityName",
  "edu.owner": "owner",
  "equity.grantType": GRANT_TYPE_MAP,
  // stock_option_accounts.owner is an enum (client | spouse), not owner rows
  "equity.owner": PERSON_MAP,
  "notes_rec.paymentType": NOTE_PAY_MAP,
  "notes_rec.owner": "owner",
  "notes_rec.ownerEntity": "entityName",
  // real estate, business and debts
  "realestate.propertyType": PROPERTY_TYPE_MAP,
  "realestate.owner": "owner",
  "realestate.jointTitling": TITLING_MAP,
  "realestate.ownerEntity": "entityName",
  "business.businessType": BUSINESS_TYPE_MAP,
  "business.taxTreatment": BUSINESS_TAX_MAP,
  "liab.type": LIABILITY_TYPE_MAP,
  "liab.owner": "owner",
  "liab.interestDeductible": "yesNo",
  "liab.ownerEntity": "entityName",
  // income
  "ss.benefitSource": SS_SOURCE_MAP,
  "ss.whenToClaim": SS_CLAIM_MAP,
  "ss.claimAgeYears": "integer",
  "income.type": INCOME_TYPE_MAP,
  // incomes.owner is an enum (client | spouse | joint), not owner rows
  "income.owner": INCOME_OWNER_MAP,
  "income.taxType": TAX_TYPE_MAP,
  "income.paidInMonth": "month",
  // expenses and savings
  "living_items.frequency": FREQ_MAP,
  "expenses.type": EXPENSE_TYPE_MAP,
  "savings.contribution": CONTRIB_MAP,
  // insurance
  "life.policyType": LIFE_POLICY_TYPE_MAP,
  "life.insured": INSURED_MAP,
  "life.owner": "owner",
  "life.premiumPaidBy": PAID_BY_MAP,
  "life.termEndsAtRetirement": "yesNo",
  "life.ownerEntity": "entityName",
  "disability.whoIsCovered": PERSON_MAP,
  "disability.coveredEarnings": DI_EARNINGS_MAP,
  "disability.shortTerm": "yesNo",
  "disability.longTerm": "yesNo",
  "disability.benefitsRun": DI_RUNS_MAP,
  "disability.benefitsTaxable": "yesNo",
  "disability.premiumPayer": DI_PAYER_MAP,
  "ltc.whoIsCovered": PERSON_MAP,
  "ltc.policyType": LTC_KIND_MAP,
  "ltc.benefitPer": LTC_PER_MAP,
  "ltc.benefitsLast": LTC_LAST_MAP,
  "ltc.policyPays": LTC_PAYS_MAP,
  "ltc.sharedCare": "yesNo",
  "ltc.statePartnership": "yesNo",
  "ltc.inflationProtection": LTC_INFL_MAP,
  "ltc.premiumsPaid": LTC_PREM_MAP,
  // estate
  "trusts.trustType": TRUST_TYPE_MAP,
  "trusts.grantor": TRUST_GRANTOR_MAP,
  "trusts.grantorTrust": "yesNo",
  "trusts.crummey": "yesNo",
  "trusts.trustEnds": TRUST_ENDS_MAP,
  "bequests.willOf": PERSON_MAP,
  "bequests.gift": BEQUEST_KIND_MAP,
  "bequests.condition": BEQUEST_COND_MAP,
  "gifts.from": GIFT_FROM_MAP,
  "gifts.form709Filed": "yesNo",
};
