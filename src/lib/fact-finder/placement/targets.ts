// src/lib/fact-finder/placement/targets.ts
/**
 * Every record a fact finder review can write, and per field: the advisor's
 * label, how the value is encoded (ValueKind), how a choice prints, whether it
 * names or owns the record (D8: it starts unticked on an existing record), and
 * whether the AI step may fill it. Field keys are the DETAIL_ENTITIES keys of
 * the same-id entity — the Details request-payload keys — except the
 * composites in FACT_FINDER_ONLY. A test pins both. Pure — no IO.
 */
import { OBSERVATION_TOPICS, TOPIC_LABELS } from "@/lib/schemas/observations";
import type { TargetKind } from "../change-set";
import {
  ANNUITY_INCOME_MAP, ANNUITY_PAYOUT_MAP, ANNUITY_PRODUCT_MAP, ANNUITY_TAX_MAP, BENE_KIND_MAP, BEQUEST_COND_MAP,
  BEQUEST_KIND_MAP, BUSINESS_TAX_MAP, BUSINESS_TYPE_MAP, CASH_TYPE_MAP, CHARITY_TYPE_MAP, DEPENDENT_MAP,
  DI_EARNINGS_MAP, DI_PAYER_MAP, DI_RUNS_MAP, EXPENSE_TYPE_MAP, FILING_MAP, GIFT_FROM_MAP, GRANT_TYPE_MAP,
  INCOME_OWNER_MAP, INCOME_TYPE_MAP, INSURED_MAP, LIABILITY_TYPE_MAP, LIFE_POLICY_TYPE_MAP, LTC_INFL_MAP,
  LTC_KIND_MAP, LTC_LAST_MAP, LTC_PAYS_MAP, LTC_PER_MAP, LTC_PREM_MAP, NOTE_PAY_MAP, PAID_BY_MAP, PERSON_MAP,
  PROPERTY_TYPE_MAP, RELATIONSHIP_MAP, RETIRE_TYPE_MAP, SS_CLAIM_MAP, SS_SOURCE_MAP, TAX_TYPE_MAP,
  TAXABLE_TYPE_MAP, TITLING_MAP, TRUST_ENDS_MAP, TRUST_GRANTOR_MAP, TRUST_TYPE_MAP,
  type OptionMap,
} from "../enums";
import { STATES } from "../schema";

export type ValueKind =
  | "text" | "money" | "number" | "integer"
  | "year"           // a whole year, 2026
  | "month"          // 1..12
  | "rate"           // a fraction: 6.5% is 0.065
  | "percent"        // a whole percent: 50 is 50%
  | "date"           // "YYYY-MM-DD"
  | "monthYear"      // "YYYY-MM"
  | "boolean"
  | "choice"         // the enum value; `options` prints it
  | "ref"            // a RecordRef
  | "personOrName"   // a RecordRef to a household person or family member, or a plain name (a 529's beneficiary / grantor)
  | "owners"         // { who: RecordRef; percent: number /* fraction */ }[]
  | "policyOwner"    // "joint" | RecordRef (a life policy's owner)
  | "beneficiaries"  // { tier: "primary" | "contingent" | "income" | "remainder"; who: RecordRef; percentage: number /* whole */ }[]
  | "recipients"     // { who: RecordRef; percentage: number /* whole */ }[]
  | "timing"         // a year, or { yearRef: "plan_start" | "plan_end" | "client_retirement" | "spouse_retirement" }
  | "items"          // living items { name: string; amount: number; frequency: "monthly" | "annual" }[]
  | "holdings"       // { ticker: string | null; name: string | null; shares: number | null; price: number | null; marketValue: number | null; costBasis: number | null }[]
  | "tranches";      // { vestDate: string; shares: number }[]

export interface TargetField {
  label: string;
  kind: ValueKind;
  options?: OptionMap;                 // choice fields: how the change list prints the value
  identity?: "name" | "owner";         // starts unticked on an existing record unless on record is blank (D8)
  overwritesNotes?: true;              // replaces notes an advisor wrote: starts unticked the same way
  replacesSet?: true;                  // the record's whole set: changing one that names someone says it replaces them
  proposable?: true;                   // the AI step may fill it (scalar kinds only)
}
export interface TargetSpec { label: string; fields: Readonly<Record<string, TargetField>> }

type Extra = Omit<TargetField, "label" | "kind" | "options">;
const field = (label: string, kind: ValueKind, extra: Extra = {}): TargetField => ({ label, kind, ...extra });
const choice = (label: string, options: OptionMap, extra: Extra = {}): TargetField => ({ label, kind: "choice", options, ...extra });

const NAME = { identity: "name" } as const;
const OWNER = { identity: "owner" } as const;
/**
 * The AI step may fill it: a plain value a note or a cell that didn't fit can
 * state on its own — an amount, a rate, a date, a carrier, a note. Never a name
 * or an owner, a choice, a reference or a set; never a value that means nothing
 * without its mode or companion (a growth rate needs growthSource "custom", a
 * claim age its claiming mode, a Social Security amount its benefit mode); never
 * `account.basis`, which is cost basis on one account and after-tax basis on another.
 */
const AI = { proposable: true } as const;

/** accounts.sub_type across the account sections (each section's map is its own; "Other" repeats). */
const ACCOUNT_TYPE_OPTIONS: OptionMap = [
  ...CASH_TYPE_MAP, ...TAXABLE_TYPE_MAP, ...RETIRE_TYPE_MAP, ...ANNUITY_TAX_MAP, ...PROPERTY_TYPE_MAP,
].filter(([, value], i, all) => all.findIndex(([, v]) => v === value) === i);
const STATE_OPTIONS: OptionMap = STATES.map((code) => [code, code] as const);
const TOPIC_OPTIONS: OptionMap = OBSERVATION_TOPICS.map((topic) => [TOPIC_LABELS[topic], topic] as const);

/** A set the route writes whole (BENEFICIARY_SET): one replacing a set that names someone says so. */
const SET = { replacesSet: true } as const;
const beneficiaries = { beneficiaries: field("Beneficiaries", "beneficiaries", SET) };

export const TARGETS: Readonly<Record<TargetKind, TargetSpec>> = {
  client_household: {
    label: "Household",
    fields: {
      firstName: field("First name", "text", NAME),
      lastName: field("Last name", "text", NAME),
      dateOfBirth: field("Date of birth", "date"),
      retirementAge: field("Retirement age", "integer"),
      retirementMonth: field("Retirement month", "month"),
      lifeExpectancy: field("Plan to age", "integer"),
      email: field("Email", "text", AI),
      phone: field("Phone", "text", AI),
      mobile: field("Mobile", "text", AI),
      employer: field("Employer", "text", AI),
      spouseName: field("Co-client first name", "text", NAME),
      spouseLastName: field("Co-client last name", "text", NAME),
      spouseDob: field("Co-client date of birth", "date"),
      spouseRetirementAge: field("Co-client retirement age", "integer"),
      spouseRetirementMonth: field("Co-client retirement month", "month"),
      spouseLifeExpectancy: field("Co-client plan to age", "integer"),
      spouseEmail: field("Co-client email", "text", AI),
      spousePhone: field("Co-client phone", "text", AI),
      spouseMobile: field("Co-client mobile", "text", AI),
      spouseEmployer: field("Co-client employer", "text", AI),
      filingStatus: choice("Filing status", FILING_MAP),
      addressLine1: field("Street address", "text", AI),
      addressLine2: field("Address line 2", "text", AI),
      city: field("City", "text", AI),
      state: field("State", "text", AI),
      postalCode: field("ZIP", "text", AI),
    },
  },
  plan_settings_tax_rates: {
    label: "Tax settings",
    fields: {
      coveredByWorkplacePlan: choice("Covered by a workplace plan", DEPENDENT_MAP),
      spouseCoveredByWorkplacePlan: choice("Co-client covered by a workplace plan", DEPENDENT_MAP),
      residenceState: choice("State of residence", STATE_OPTIONS),
    },
  },
  family_member: {
    label: "Family member",
    fields: {
      firstName: field("First name", "text", NAME),
      lastName: field("Last name", "text", NAME),
      relationship: choice("Relationship", RELATIONSHIP_MAP),
      dateOfBirth: field("Date of birth", "date", AI),
      claimedAsDependent: choice("Claimed as dependent", DEPENDENT_MAP),
      domesticPartner: field("Domestic partner", "boolean"),
      notes: field("Notes", "text", AI),
    },
  },
  external_beneficiary: {
    label: "Charity or other beneficiary",
    fields: {
      name: field("Name", "text", NAME),
      kind: choice("Kind", BENE_KIND_MAP),
      charityType: choice("Charity type", CHARITY_TYPE_MAP),
      notes: field("Notes", "text", AI),
    },
  },
  related_party: {
    label: "Related party",
    fields: {
      firstName: field("First name", "text", NAME),
      lastName: field("Last name", "text", NAME),
      employer: field("Firm", "text", AI),
      notes: field("Notes", "text", AI),
    },
  },
  account: {
    label: "Account",
    fields: {
      name: field("Account name", "text", NAME),
      value: field("Current value", "money", AI),
      accountNumberLast4: field("Last 4", "text"),
      custodian: field("Custodian", "text", AI),
      subType: choice("Account type", ACCOUNT_TYPE_OPTIONS),
      owners: field("Owner", "owners", OWNER),
      titlingType: choice("Joint titling", TITLING_MAP),
      holdings: field("Holdings", "holdings"),
      growthRate: field("Growth rate", "rate"),
      basis: field("Basis", "money"),
      rothValue: field("Roth portion", "money"),
      inheritedOwnerBirthYear: field("Original owner's birth year", "year"),
      inheritedDeathYear: field("Original owner's year of death", "year"),
      priorYearEndValue: field("Prior year-end value", "money", AI),
      beneficiary: field("Beneficiary (student)", "personOrName"),
      grantor: field("Grantor", "personOrName"),
      propertyAddress: field("Address", "text", AI),
      annualPropertyTax: field("Annual property tax", "money", AI),
    },
  },
  business_account: {
    label: "Business",
    fields: {
      name: field("Business name", "text", NAME),
      businessType: choice("Business type", BUSINESS_TYPE_MAP),
      value: field("Current value", "money", AI),
      basis: field("Cost basis", "money", AI),
      owners: field("Owners", "owners", OWNER),
      businessTaxTreatment: choice("Tax treatment", BUSINESS_TAX_MAP),
      distributionPolicyPercent: field("Share of earnings distributed", "rate", AI),
    },
  },
  account_beneficiary_designation: { label: "Account beneficiaries", fields: beneficiaries },
  annuity_contract: {
    label: "Annuity contract",
    fields: {
      costBasis: field("Cost basis", "money", AI),
      productType: choice("Product type", ANNUITY_PRODUCT_MAP),
      incomeMode: choice("Income", ANNUITY_INCOME_MAP),
      payoutStructure: choice("Payout structure", ANNUITY_PAYOUT_MAP),
    },
  },
  stock_option_account: {
    label: "Stock options",
    fields: {
      name: field("Company", "text", NAME),
      ticker: field("Ticker", "text"),
      owner: choice("Owner", PERSON_MAP, OWNER),
    },
  },
  stock_option_grant: {
    label: "Stock option grant",
    fields: {
      grantType: choice("Grant type", GRANT_TYPE_MAP),
      grantNumber: field("Grant number", "text", AI),
      grantDate: field("Grant date", "date", AI),
      sharesGranted: field("Shares granted", "number", AI),
      strikePrice: field("Strike price", "number", AI),
      expirationDate: field("Expiration date", "date", AI),
      tranches: field("Vesting schedule", "tranches"),
      notes: field("Notes", "text", AI),
    },
  },
  note_receivable: {
    label: "Note receivable",
    fields: {
      name: field("Borrower", "text", NAME),
      faceValue: field("Original amount", "money", AI),
      basis: field("Cost basis", "money"),
      asOfBalance: field("Current balance", "money", AI),
      balanceAsOf: field("Balance as of", "monthYear"),
      interestRate: field("Interest rate", "rate", AI),
      paymentType: choice("Payment type", NOTE_PAY_MAP),
      monthlyPayment: field("Monthly payment", "money", AI),
      start: field("Start", "monthYear"),
      termMonths: field("Term (months)", "integer", AI),
      owners: field("Owner", "owners", OWNER),
    },
  },
  liability: {
    label: "Liability",
    fields: {
      name: field("Loan name", "text", NAME),
      liabilityType: choice("Type", LIABILITY_TYPE_MAP),
      owners: field("Owner", "owners", OWNER),
      balance: field("Balance", "money", AI),
      balanceAsOf: field("Balance as of", "monthYear"),
      interestRate: field("Interest rate", "rate", AI),
      monthlyPayment: field("Monthly P&I", "money", AI),
      start: field("Loan start", "monthYear"),
      termMonths: field("Term (months)", "integer", AI),
      isInterestDeductible: field("Interest deductible", "boolean"),
      linkedPropertyId: field("Property it's on", "ref"),
    },
  },
  income: {
    label: "Income",
    fields: {
      name: field("Name", "text", NAME),
      type: choice("Type", INCOME_TYPE_MAP),
      owner: choice("Owner", INCOME_OWNER_MAP, OWNER),
      annualAmount: field("Annual amount", "money"),
      growthRate: field("Annual increase", "rate"),
      start: field("Starts", "timing"),
      end: field("Ends", "timing"),
      taxType: choice("Tax type", TAX_TYPE_MAP),
      paymentMonth: field("Paid in month", "month"),
      survivorshipPct: field("Survivor continues", "rate"),
      ssBenefitMode: choice("Benefit source", SS_SOURCE_MAP),
      piaMonthly: field("Monthly benefit at full retirement age", "money"),
      ssStatedAge: field("Benefit stated at age", "integer"),
      claimingAgeMode: choice("When to claim", SS_CLAIM_MAP),
      claimingAge: field("Claim age (years)", "integer"),
      claimingAgeMonths: field("Claim age (+ months)", "integer"),
    },
  },
  expense: {
    label: "Expense",
    fields: {
      name: field("Name", "text", NAME),
      type: choice("Type", EXPENSE_TYPE_MAP),
      annualAmount: field("Annual amount", "money", AI),
      growthRate: field("Annual increase", "rate"),
      start: field("Starts", "timing"),
      end: field("Ends", "timing"),
      isGoal: field("A goal", "boolean"),
      livingItems: field("Itemized living expenses", "items"),
    },
  },
  savings_rule: {
    label: "Planned savings",
    fields: {
      accountId: field("Account", "ref"),
      contributeMax: field("IRS maximum", "boolean"),
      annualAmount: field("Annual amount", "money"),
      annualPercent: field("% of salary", "rate"),
      rothPercent: field("Roth share", "rate", AI),
      employerMatchPct: field("Employer match", "rate", AI),
      employerMatchCap: field("Match up to (% of salary)", "rate", AI),
      employerMatchAmount: field("Employer flat amount", "money", AI),
      start: field("Starts", "timing"),
      end: field("Ends", "timing"),
      growthRate: field("Annual increase", "rate"),
    },
  },
  life_insurance_policy: {
    label: "Life insurance policy",
    fields: {
      name: field("Policy name", "text", NAME),
      carrier: field("Carrier", "text", AI),
      policyNumberLast4: field("Policy # (last 4)", "text"),
      policyType: choice("Policy type", LIFE_POLICY_TYPE_MAP),
      insuredPerson: choice("Insured", INSURED_MAP),
      ownerRef: field("Owner", "policyOwner", OWNER),
      faceValue: field("Death benefit", "money", AI),
      cashValue: field("Cash value", "money", AI),
      costBasis: field("Cost basis (premiums paid)", "money", AI),
      premiumAmount: field("Annual premium", "money", AI),
      premiumPayer: choice("Premium paid by", PAID_BY_MAP),
      premiumYears: field("Premium payment years", "integer", AI),
      termIssueYear: field("Term issue year", "year", AI),
      termLengthYears: field("Term length (years)", "integer"),
      endsAtInsuredRetirement: field("Term ends at the insured's retirement", "boolean"),
    },
  },
  life_insurance_policy_beneficiary: { label: "Policy beneficiaries", fields: beneficiaries },
  disability_policy: {
    label: "Disability policy",
    fields: {
      name: field("Policy name", "text", NAME),
      carrier: field("Carrier", "text", AI),
      insured: choice("Who is covered", PERSON_MAP),
      coveredEarningsMode: choice("Covered earnings", DI_EARNINGS_MAP),
      coveredEarningsAmount: field("Covered earnings amount", "money"),
      hasShortTerm: field("Short-term coverage", "boolean"),
      stdEliminationDays: field("Short-term waiting period (days)", "integer", AI),
      stdBenefitPct: field("Short-term benefit (% of earnings)", "rate", AI),
      stdDurationWeeks: field("Short-term duration (weeks)", "integer", AI),
      stdMonthlyMax: field("Short-term monthly cap", "money", AI),
      hasLongTerm: field("Long-term coverage", "boolean"),
      ltdEliminationDays: field("Long-term waiting period (days)", "integer", AI),
      ltdBenefitPct: field("Long-term benefit (% of earnings)", "rate", AI),
      ltdMonthlyMax: field("Long-term monthly cap", "money", AI),
      ltdBenefitPeriodMode: choice("Benefits run", DI_RUNS_MAP),
      ltdBenefitPeriodAge: field("Benefits run to age", "integer"),
      ltdBenefitPeriodYears: field("Benefits run for (years)", "integer"),
      benefitTaxable: field("Benefits taxable", "boolean"),
      colaRate: field("Annual increase", "rate", AI),
      annualPremium: field("Annual premium", "money", AI),
      premiumPayer: choice("Who pays the premium", DI_PAYER_MAP),
      notes: field("Notes", "text", AI),
    },
  },
  ltc_policy: {
    label: "Long-term care policy",
    fields: {
      name: field("Policy name", "text", NAME),
      carrier: field("Carrier", "text", AI),
      insured: choice("Who is covered", PERSON_MAP),
      kind: choice("Policy type", LTC_KIND_MAP),
      lifePolicyAccountId: field("Life policy (if rider)", "ref"),
      issueYear: field("Issue year", "year", AI),
      benefitAmount: field("Benefit amount", "money", AI),
      benefitUnit: choice("Benefit per", LTC_PER_MAP),
      benefitPeriodMode: choice("Benefits last", LTC_LAST_MAP),
      benefitPeriodYears: field("Benefit years", "integer"),
      eliminationDays: field("Waiting period (days)", "integer", AI),
      homeCarePct: field("Home care pays (% of limit)", "rate", AI),
      benefitType: choice("Policy pays", LTC_PAYS_MAP),
      sharedCare: field("Shared care", "boolean"),
      partnership: field("State partnership policy", "boolean"),
      inflationRider: choice("Inflation protection", LTC_INFL_MAP),
      inflationRate: field("Inflation rate", "rate"),
      annualPremium: field("Annual premium", "money"),
      premiumPayMode: choice("Premiums paid", LTC_PREM_MAP),
      premiumPayToAge: field("Premiums paid to age", "integer"),
      premiumPayYears: field("Premiums paid for (years)", "integer"),
      notes: field("Notes", "text", AI),
    },
  },
  entity: {
    label: "Trust",
    fields: {
      name: field("Trust name", "text", NAME),
      trustSubType: choice("Trust type", TRUST_TYPE_MAP),
      grantor: choice("Grantor", TRUST_GRANTOR_MAP),
      trustee: field("Trustee", "text", AI),
      isGrantor: field("Grantor trust", "boolean"),
      crummeyPowers: field("Crummey powers", "boolean"),
      trustEnds: choice("Trust ends", TRUST_ENDS_MAP),
      notes: field("Notes", "text", AI),
    },
  },
  trust_beneficiary_designation: { label: "Trust beneficiaries", fields: beneficiaries },
  revocable_trust: {
    label: "Revocable living trust",
    fields: { name: field("Trust name", "text", NAME) },
  },
  will: {
    label: "Will",
    fields: { grantor: choice("Will of", PERSON_MAP) },
  },
  will_bequest: {
    label: "Will provision",
    fields: {
      kind: choice("Gift", BEQUEST_KIND_MAP),
      accountId: field("Asset", "ref"),
      liabilityId: field("Debt", "ref"),
      percentage: field("% of it", "percent"),
      recipients: field("Recipients", "recipients"),
      condition: choice("Condition", BEQUEST_COND_MAP),
    },
  },
  will_residuary_recipient: {
    label: "Remaining estate",
    fields: { recipients: field("Recipients", "recipients", SET) },
  },
  gift: {
    label: "Prior gift",
    fields: {
      year: field("Year", "year", AI),
      grantor: choice("From", GIFT_FROM_MAP),
      recipient: field("Recipient", "ref"),
      amount: field("Amount", "money", AI),
      notes: field("Notes", "text", { ...AI, overwritesNotes: true }),
    },
  },
  plan_observation: {
    label: "Plan note",
    fields: {
      topic: choice("Topic", TOPIC_OPTIONS),
      body: field("Note", "text"),
    },
  },
};

const TIMING = "A year, or a milestone (plan start or end, a retirement) that sets the year — the row's start or end year.";
const MONTH_YEAR = "The fact finder asks one month-and-year cell; Details keeps the month and the year apart.";
const MONTH_YEAR_TIED = `${MONTH_YEAR} A typed one clears the milestone Details can tie the year to.`;
const BENEFICIARY_SET = "The record's beneficiaries, written as one set — the route replaces them all.";
const DESIGNATION_KEYS = ["tier", "percentage", "familyMemberId", "externalBeneficiaryId", "entityIdRef", "householdRole", "sortOrder"] as const;

/** Keys that aren't DETAIL_ENTITIES keys: payloadFor (Task 17) expands them into these payload keys. */
export const FACT_FINDER_ONLY: Readonly<Record<string /* `${target}.${key}` */, { expandsTo: readonly string[]; why: string }>> = {
  "client_household.employer": {
    expandsTo: [],
    why: "The client's employer lives on their CRM contact (crm_household_contacts.employer), which the household update doesn't write; Plan 4 writes it there.",
  },
  "client_household.spouseEmployer": {
    expandsTo: [],
    why: "The co-client's employer lives on their CRM contact (crm_household_contacts.employer), which the household update doesn't write; Plan 4 writes it there.",
  },
  "account.beneficiary": {
    expandsTo: ["beneficiaryFamilyMemberId", "beneficiaryName"],
    why: "A 529's beneficiary is a family member or, when the name matches none, the name itself — one key or the other.",
  },
  "account.grantor": {
    expandsTo: ["grantorFamilyMemberId", "grantorName"],
    why: "A 529's grantor is a household member or, when the name matches none, the name itself — one key or the other.",
  },
  "account.holdings": {
    expandsTo: [],
    why: "The account's positions, saved by the holdings writer (account_holdings), not the account's own payload.",
  },
  "account_beneficiary_designation.beneficiaries": { expandsTo: DESIGNATION_KEYS, why: BENEFICIARY_SET },
  "note_receivable.balanceAsOf": { expandsTo: ["balanceAsOfMonth", "balanceAsOfYear"], why: MONTH_YEAR },
  "note_receivable.start": { expandsTo: ["startMonth", "startYear", "startYearRef"], why: MONTH_YEAR_TIED },
  "liability.balanceAsOf": { expandsTo: ["balanceAsOfMonth", "balanceAsOfYear"], why: MONTH_YEAR },
  "liability.start": { expandsTo: ["startMonth", "startYear", "startYearRef"], why: MONTH_YEAR_TIED },
  "income.start": { expandsTo: ["startYear", "startYearRef"], why: TIMING },
  "income.end": { expandsTo: ["endYear", "endYearRef"], why: TIMING },
  "expense.start": { expandsTo: ["startYear", "startYearRef"], why: TIMING },
  "expense.end": { expandsTo: ["endYear", "endYearRef"], why: TIMING },
  "savings_rule.start": { expandsTo: ["startYear", "startYearRef"], why: TIMING },
  "savings_rule.end": { expandsTo: ["endYear", "endYearRef"], why: TIMING },
  "life_insurance_policy_beneficiary.beneficiaries": { expandsTo: DESIGNATION_KEYS, why: BENEFICIARY_SET },
  "trust_beneficiary_designation.beneficiaries": { expandsTo: DESIGNATION_KEYS, why: BENEFICIARY_SET },
  "will_residuary_recipient.recipients": {
    expandsTo: ["recipientKind", "recipientId", "percentage", "sortOrder"],
    why: "Everyone who receives the rest of one will's estate, as one set (the will's residuaryRecipients).",
  },
  "gift.recipient": {
    expandsTo: ["recipientFamilyMemberId", "recipientEntityId", "recipientExternalBeneficiaryId"],
    why: "A gift has one recipient: the key it's saved under depends on what kind of record it names.",
  },
};

export function targetField(target: TargetKind, key: string): TargetField | undefined {
  const { fields } = TARGETS[target];
  return Object.hasOwn(fields, key) ? fields[key] : undefined;
}
