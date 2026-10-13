// src/lib/fact-finder/__tests__/enums.test.ts
import { describe, expect, it } from "vitest";
import {
  accountBusinessTypeEnum,
  annuityIncomeModeEnum,
  annuityPayoutStructureEnum,
  annuityProductTypeEnum,
  charityTypeEnum,
  dependentOverrideEnum,
  disabilityBenefitPeriodEnum,
  disabilityEarningsModeEnum,
  disabilityPremiumPayerEnum,
  entityGrantorEnum,
  entityTaxTreatmentEnum,
  externalBeneficiaryKindEnum,
  familyRelationshipEnum,
  filingStatusEnum,
  grantTypeEnum,
  incomeTaxTypeEnum,
  liabilityTypeEnum,
  ltcBenefitPeriodEnum,
  ltcBenefitTypeEnum,
  ltcBenefitUnitEnum,
  ltcInflationRiderEnum,
  ltcPolicyKindEnum,
  ltcPremiumPayEnum,
  notePaymentTypeEnum,
  premiumPayerEnum,
  titlingTypeEnum,
  trustEndsEnum,
  willBequestKindEnum,
  willConditionEnum,
} from "@/db/schema";
import type { Income, LivingItemFrequency } from "@/engine/types";
import { TRUST_SUB_TYPES } from "@/lib/entities/trust";
import {
  ANNUITY_TAX,
  CASH_TYPE,
  EXPENSE_TYPE,
  FACT_FINDER_SECTIONS,
  GIFT_FROM,
  INCOME_OWNER,
  INCOME_TYPE,
  INSURED,
  MONTHS,
  OWNER,
  OWNER_PERSON,
  POLICY_OWNER,
  POLICY_TYPE,
  PROPERTY_TYPE,
  RETIRE_TYPE,
  SS_AGES,
  STATES,
  TAXABLE_TYPE,
  YES_NO,
  type FFColumn,
} from "../schema";
import {
  ANNUITY_INCOME_MAP,
  ANNUITY_PAYOUT_MAP,
  ANNUITY_PRODUCT_MAP,
  ANNUITY_TAX_MAP,
  BENE_KIND_MAP,
  BEQUEST_COND_MAP,
  BEQUEST_KIND_MAP,
  BUSINESS_TAX_MAP,
  BUSINESS_TYPE_MAP,
  CASH_TYPE_MAP,
  CHARITY_TYPE_MAP,
  CHOICE_READERS,
  CONTRIB_MAP,
  DEPENDENT_MAP,
  DI_EARNINGS_MAP,
  DI_PAYER_MAP,
  DI_RUNS_MAP,
  EXPENSE_TYPE_MAP,
  FILING_MAP,
  FREQ_MAP,
  GIFT_FROM_MAP,
  GRANT_TYPE_MAP,
  INCOME_OWNER_MAP,
  INCOME_TYPE_MAP,
  INSURED_MAP,
  LIABILITY_TYPE_MAP,
  LIFE_POLICY_TYPE_MAP,
  LTC_INFL_MAP,
  LTC_KIND_MAP,
  LTC_LAST_MAP,
  LTC_PAYS_MAP,
  LTC_PER_MAP,
  LTC_PREM_MAP,
  NOTE_PAY_MAP,
  OWNER_MAP,
  PAID_BY_MAP,
  PERSON_MAP,
  PROPERTY_TYPE_MAP,
  RELATIONSHIP_MAP,
  RETIRE_TYPE_MAP,
  SS_CLAIM_MAP,
  SS_SOURCE_MAP,
  TAX_TYPE_MAP,
  TAXABLE_TYPE_MAP,
  TITLING_MAP,
  TRUST_ENDS_MAP,
  TRUST_GRANTOR_MAP,
  TRUST_TYPE_MAP,
  labelFor,
  valueFor,
  type ChoiceReader,
  type OptionMap,
} from "../enums";

const pairs: Array<[string, OptionMap, readonly string[]]> = [
  ["cash type", CASH_TYPE_MAP, CASH_TYPE],
  ["taxable type", TAXABLE_TYPE_MAP, TAXABLE_TYPE],
  ["retirement type", RETIRE_TYPE_MAP, RETIRE_TYPE],
  ["annuity tax", ANNUITY_TAX_MAP, ANNUITY_TAX],
  ["property type", PROPERTY_TYPE_MAP, PROPERTY_TYPE],
  ["life policy type", LIFE_POLICY_TYPE_MAP, POLICY_TYPE],
  ["income type", INCOME_TYPE_MAP, INCOME_TYPE],
  ["expense type", EXPENSE_TYPE_MAP, EXPENSE_TYPE],
  ["insured", INSURED_MAP, INSURED],
  ["gift from", GIFT_FROM_MAP, GIFT_FROM],
  ["income owner", INCOME_OWNER_MAP, INCOME_OWNER],
  ["person", PERSON_MAP, OWNER_PERSON],
];

describe("option maps", () => {
  it.each(pairs)("%s maps exactly the schema's options", (_name, map, options) => {
    expect(map.map(([label]) => label)).toEqual([...options]);
  });

  it("covers the owner labels that name people", () => {
    expect(OWNER_MAP.map(([label]) => label)).toEqual(OWNER.filter((o) => o !== "Trust / entity"));
  });

  it("translates both ways", () => {
    expect(labelFor(RETIRE_TYPE_MAP, "401k")).toBe("401(k)");
    expect(valueFor(RETIRE_TYPE_MAP, "SEP IRA")).toBe("sep_ira");
    expect(labelFor(OWNER_MAP, "spouse")).toBe("Co-client");
    expect(labelFor(CASH_TYPE_MAP, "unknown")).toBeNull();
    expect(valueFor(INCOME_TYPE_MAP, "Deferred comp")).toBe("deferred");
  });
});

const values = (map: OptionMap) => map.map(([, value]) => value);
const sorted = (list: readonly string[]) => [...list].sort();

describe("option maps — the values each one stores", () => {
  it.each<[string, OptionMap, readonly string[]]>([
    ["filing status", FILING_MAP, filingStatusEnum.enumValues],
    ["relationship", RELATIONSHIP_MAP, familyRelationshipEnum.enumValues],
    ["claimed as dependent", DEPENDENT_MAP, dependentOverrideEnum.enumValues],
    ["beneficiary kind", BENE_KIND_MAP, externalBeneficiaryKindEnum.enumValues],
    ["charity type", CHARITY_TYPE_MAP, charityTypeEnum.enumValues],
    ["joint titling", TITLING_MAP, titlingTypeEnum.enumValues],
    ["annuity product", ANNUITY_PRODUCT_MAP, annuityProductTypeEnum.enumValues],
    ["annuity income", ANNUITY_INCOME_MAP, annuityIncomeModeEnum.enumValues],
    ["annuity payout", ANNUITY_PAYOUT_MAP, annuityPayoutStructureEnum.enumValues],
    ["grant type", GRANT_TYPE_MAP, grantTypeEnum.enumValues],
    ["note payment", NOTE_PAY_MAP, notePaymentTypeEnum.enumValues],
    ["business type", BUSINESS_TYPE_MAP, accountBusinessTypeEnum.enumValues],
    ["business tax treatment", BUSINESS_TAX_MAP, entityTaxTreatmentEnum.enumValues],
    ["liability type", LIABILITY_TYPE_MAP, liabilityTypeEnum.enumValues],
    ["income tax type", TAX_TYPE_MAP, incomeTaxTypeEnum.enumValues],
    ["life premium payer", PAID_BY_MAP, premiumPayerEnum.enumValues],
    ["disability covered earnings", DI_EARNINGS_MAP, disabilityEarningsModeEnum.enumValues],
    ["disability benefits run", DI_RUNS_MAP, disabilityBenefitPeriodEnum.enumValues],
    ["disability premium payer", DI_PAYER_MAP, disabilityPremiumPayerEnum.enumValues],
    ["LTC kind", LTC_KIND_MAP, ltcPolicyKindEnum.enumValues],
    ["LTC benefit per", LTC_PER_MAP, ltcBenefitUnitEnum.enumValues],
    ["LTC benefits last", LTC_LAST_MAP, ltcBenefitPeriodEnum.enumValues],
    ["LTC policy pays", LTC_PAYS_MAP, ltcBenefitTypeEnum.enumValues],
    ["LTC inflation", LTC_INFL_MAP, ltcInflationRiderEnum.enumValues],
    ["LTC premiums paid", LTC_PREM_MAP, ltcPremiumPayEnum.enumValues],
    ["trust ends", TRUST_ENDS_MAP, trustEndsEnum.enumValues],
    ["bequest condition", BEQUEST_COND_MAP, willConditionEnum.enumValues],
    // Not stored as-is: "revocable" routes the row to revocable_trust (the app's trust
    // sub-types no longer include it), "none" saves as a null grantor, "residuary" makes
    // will_residuary_recipient rows.
    ["trust type", TRUST_TYPE_MAP, [...TRUST_SUB_TYPES, "revocable"]],
    ["trust grantor", TRUST_GRANTOR_MAP, [...entityGrantorEnum.enumValues, "none"]],
    ["bequest kind", BEQUEST_KIND_MAP, [...willBequestKindEnum.enumValues, "residuary"]],
  ])("%s", (_name, map, stored) => {
    expect(sorted(values(map))).toEqual(sorted(stored));
  });

  it("Social Security and living-item values are the engine's", () => {
    const ssModes: NonNullable<Income["ssBenefitMode"]>[] = ["pia_at_fra", "manual_amount", "no_benefit"];
    const claimModes: NonNullable<Income["claimingAgeMode"]>[] = ["fra", "at_retirement", "years"];
    const frequencies: LivingItemFrequency[] = ["monthly", "annual"];
    // "Estimate from salary" is never stored: the Social Security map turns it into pia_at_fra.
    expect(sorted(values(SS_SOURCE_MAP).filter((v) => v !== "estimate_from_salary"))).toEqual(sorted(ssModes));
    expect(sorted(values(SS_CLAIM_MAP))).toEqual(sorted(claimModes));
    expect(sorted(values(FREQ_MAP))).toEqual(sorted(frequencies));
  });

  it("translates the labels the brief calls out", () => {
    expect(valueFor(BUSINESS_TYPE_MAP, "Sole proprietorship")).toBe("sole_prop");
    expect(valueFor(RELATIONSHIP_MAP, "Son/Daughter-in-law")).toBe("child_in_law");
    expect(valueFor(TAX_TYPE_MAP, "Qualified dividends")).toBe("dividends");
    expect(valueFor(DI_EARNINGS_MAP, "Stated amount")).toBe("manual");
    expect(valueFor(PAID_BY_MAP, "Co-client")).toBe("spouse");
    expect(valueFor(TRUST_GRANTOR_MAP, "Someone else")).toBe("none");
    expect(valueFor(CONTRIB_MAP, "IRS maximum")).toBe("max");
    expect(labelFor(ANNUITY_INCOME_MAP, "rider")).toBe("Income rider (GLWB)");
  });
});

type SpecialReader = Exclude<ChoiceReader, OptionMap>;

/** The option lists a special reader may read (entityName reads the text column "Which trust / entity"). */
const SPECIAL_OPTIONS: Record<SpecialReader, readonly (readonly string[] | undefined)[]> = {
  owner: [OWNER, OWNER_PERSON, POLICY_OWNER],
  yesNo: [YES_NO],
  month: [MONTHS],
  state: [STATES],
  integer: [SS_AGES],
  entityName: [undefined],
};

const readColumns: [string, FFColumn][] = FACT_FINDER_SECTIONS.flatMap((section) =>
  section.columns
    .filter((column) => column.kind === "choice" || column.id === "ownerEntity")
    .map((column): [string, FFColumn] => [`${section.id}.${column.id}`, column]),
);

describe("CHOICE_READERS", () => {
  it("reads every choice column (and Which trust / entity), and nothing else", () => {
    expect(sorted(Object.keys(CHOICE_READERS))).toEqual(sorted(readColumns.map(([key]) => key)));
  });

  it.each(readColumns)("%s reads exactly its column's options", (key, column) => {
    const reader = CHOICE_READERS[key];
    if (typeof reader === "string") {
      expect(SPECIAL_OPTIONS[reader]).toContain(column.options);
      if (reader === "owner") expect(column.id).toBe("owner");
      if (reader === "entityName") expect(column.id).toBe("ownerEntity");
    } else {
      expect(reader.map(([label]) => label)).toEqual([...(column.options ?? [])]);
    }
  });

  it("every map a column reads translates both ways, one value per label", () => {
    const maps = Object.values(CHOICE_READERS).filter((r): r is OptionMap => typeof r !== "string");
    for (const map of maps) {
      for (const [label, value] of map) {
        expect(valueFor(map, label)).toBe(value);
        expect(labelFor(map, value)).toBe(label);
      }
    }
  });

  it("reads an enum-valued owner with a map, and owner rows with the owner reader", () => {
    expect(CHOICE_READERS["cash.owner"]).toBe("owner");
    expect(CHOICE_READERS["retirement.owner"]).toBe("owner");
    expect(CHOICE_READERS["life.owner"]).toBe("owner");
    expect(CHOICE_READERS["income.owner"]).toBe(INCOME_OWNER_MAP);
    expect(CHOICE_READERS["equity.owner"]).toBe(PERSON_MAP);
    expect(CHOICE_READERS["disability.whoIsCovered"]).toBe(PERSON_MAP);
    expect(CHOICE_READERS["bequests.willOf"]).toBe(PERSON_MAP);
    expect(CHOICE_READERS["cash.ownerEntity"]).toBe("entityName");
  });
});
