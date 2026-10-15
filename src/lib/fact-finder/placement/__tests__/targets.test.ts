// src/lib/fact-finder/placement/__tests__/targets.test.ts
import { describe, expect, it } from "vitest";
import { liabilityTypeEnum } from "@/db/schema";
import { findField, type FieldKind } from "@/domain/forge/detail-fields";
import { TARGET_KINDS, type TargetKind } from "../../change-set";
import { BUSINESS_TYPE_MAP, LIFE_POLICY_TYPE_MAP } from "../../enums";
import { FACT_FINDER_ONLY, TARGETS, targetField, type ValueKind } from "../targets";

const fields = (Object.keys(TARGETS) as TargetKind[]).flatMap((target) =>
  Object.entries(TARGETS[target].fields).map(([key, field]) => ({ target, key, field, id: `${target}.${key}` })),
);

/** The catalog kinds a Details field of each kind can hold. */
const HOLDS: Record<FieldKind, readonly ValueKind[]> = {
  string: ["text"],
  text: ["text"],
  money: ["money"],
  number: ["number", "integer", "month"],
  rate: ["rate"],
  percent: ["percent"],
  year: ["year"],
  date: ["date"],
  boolean: ["boolean"],
  enum: ["choice"],
  uuid: ["ref"],
  object: ["policyOwner"],
  array: ["owners", "beneficiaries", "recipients", "items", "tranches"],
};

/** Option values a map translates but never saves as-is (enums.ts says what each becomes). */
const NOT_STORED: Record<string, readonly string[]> = {
  "income.ssBenefitMode": ["estimate_from_salary"],
  "entity.trustSubType": ["revocable"],
  "entity.grantor": ["none"],
  "will_bequest.kind": ["residuary"],
};

/** What the AI step can read a value as (Task 18). */
const PROPOSABLE_KINDS: readonly ValueKind[] = ["text", "money", "number", "integer", "year", "rate", "date", "choice"];

describe("TARGETS", () => {
  it("has a spec for every change line target", () => {
    expect(Object.keys(TARGETS).sort()).toEqual([...TARGET_KINDS].sort());
    for (const target of TARGET_KINDS) {
      expect(TARGETS[target].label, target).not.toBe("");
      expect(Object.keys(TARGETS[target].fields).length, target).toBeGreaterThan(0);
    }
  });

  it("keys every field by its Details key, except the fact finder's composites", () => {
    const unknown = fields.filter((f) => !findField(f.target, f.key) && !FACT_FINDER_ONLY[f.id]).map((f) => f.id);
    expect(unknown).toEqual([]);
  });

  it("expands every composite into Details keys of its own target", () => {
    for (const [id, { expandsTo, why }] of Object.entries(FACT_FINDER_ONLY)) {
      const [target, key] = id.split(".") as [TargetKind, string];
      expect(targetField(target, key), `${id} isn't a TARGETS field`).toBeDefined();
      expect(findField(target, key), `${id} is a Details key — drop it from FACT_FINDER_ONLY`).toBeUndefined();
      expect(why.length, id).toBeGreaterThan(20);
      for (const k of expandsTo) expect(findField(target, k), `${id} → ${k}`).toBeDefined();
    }
  });

  it("lists the composites the section maps rely on, with their kinds", () => {
    const composites = Object.fromEntries(
      Object.keys(FACT_FINDER_ONLY).map((id) => {
        const [target, key] = id.split(".") as [TargetKind, string];
        return [id, targetField(target, key)?.kind];
      }),
    );
    expect(composites).toEqual({
      "client_household.employer": "text",
      "client_household.spouseEmployer": "text",
      "account.beneficiary": "personOrName",
      "account.grantor": "personOrName",
      "account.holdings": "holdings",
      "account_beneficiary_designation.beneficiaries": "beneficiaries",
      "note_receivable.balanceAsOf": "monthYear",
      "note_receivable.start": "monthYear",
      "liability.balanceAsOf": "monthYear",
      "liability.start": "monthYear",
      "income.start": "timing",
      "income.end": "timing",
      "expense.start": "timing",
      "expense.end": "timing",
      "savings_rule.start": "timing",
      "savings_rule.end": "timing",
      "life_insurance_policy_beneficiary.beneficiaries": "beneficiaries",
      "trust_beneficiary_designation.beneficiaries": "beneficiaries",
      "will_residuary_recipient.recipients": "recipients",
      "gift.recipient": "ref",
    });
  });

  it("gives each field a kind its Details field can hold (a rate is never a percent)", () => {
    const wrong = fields.flatMap(({ target, key, field, id }) => {
      const detail = findField(target, key);
      return detail && !HOLDS[detail.kind].includes(field.kind) ? [`${id}: ${field.kind}, Details says ${detail.kind}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  it("gives every choice its options, and only choices", () => {
    for (const { field, id } of fields) {
      if (field.kind === "choice") expect(field.options?.length, id).toBeGreaterThan(0);
      else expect(field.options, id).toBeUndefined();
    }
  });

  it("offers only option values the Details field accepts, bar the ones never stored", () => {
    const wrong = fields.flatMap(({ target, key, field, id }) => {
      const accepted = findField(target, key)?.enumValues;
      if (field.kind !== "choice" || !accepted) return [];
      const skip = NOT_STORED[id] ?? [];
      return (field.options ?? [])
        .map(([, value]) => value)
        .filter((value) => !accepted.includes(value) && !skip.includes(value))
        .map((value) => `${id}: ${value}`);
    });
    expect(wrong).toEqual([]);
    // the right one of two look-alike maps
    expect(targetField("business_account", "businessType")?.options).toBe(BUSINESS_TYPE_MAP);
    expect(targetField("life_insurance_policy", "policyType")?.options).toBe(LIFE_POLICY_TYPE_MAP);
  });

  it("lets the AI step fill only plain values — never a name, an owner or a set", () => {
    for (const { field, id } of fields) {
      if (!field.proposable) continue;
      expect(PROPOSABLE_KINDS, id).toContain(field.kind);
      expect(field.identity, id).toBeUndefined();
    }
    for (const id of ["account.value", "liability.balance", "life_insurance_policy.faceValue", "entity.notes"]) {
      const [target, key] = id.split(".") as [TargetKind, string];
      expect(targetField(target, key)?.proposable, id).toBe(true);
    }
    // the same column means two things (cost basis / after-tax basis), or the value needs its mode
    for (const id of ["account.basis", "account.growthRate", "income.annualAmount", "income.piaMonthly", "savings_rule.annualAmount", "ltc_policy.annualPremium"]) {
      const [target, key] = id.split(".") as [TargetKind, string];
      expect(targetField(target, key)?.proposable, id).toBeUndefined();
    }
  });

  it("pins the full set of fields the AI step may fill, per target — making any field proposable (or not) changes this list on purpose", () => {
    const proposable: Partial<Record<TargetKind, string[]>> = {};
    for (const { target, key, field } of fields) if (field.proposable) (proposable[target] ??= []).push(key);
    expect(proposable).toEqual({
      client_household: ["email", "phone", "mobile", "employer", "spouseEmail", "spousePhone", "spouseMobile", "spouseEmployer", "addressLine1", "addressLine2", "city", "state", "postalCode"],
      family_member: ["dateOfBirth", "notes"],
      external_beneficiary: ["notes"],
      related_party: ["employer", "notes"],
      account: ["value", "custodian", "priorYearEndValue", "propertyAddress", "annualPropertyTax"],
      business_account: ["value", "basis", "distributionPolicyPercent"],
      annuity_contract: ["costBasis"],
      stock_option_grant: ["grantNumber", "grantDate", "sharesGranted", "strikePrice", "expirationDate", "notes"],
      note_receivable: ["faceValue", "asOfBalance", "interestRate", "monthlyPayment", "termMonths"],
      liability: ["balance", "interestRate", "monthlyPayment", "termMonths"],
      expense: ["annualAmount"],
      savings_rule: ["rothPercent", "employerMatchPct", "employerMatchCap", "employerMatchAmount"],
      life_insurance_policy: ["carrier", "faceValue", "cashValue", "costBasis", "premiumAmount", "premiumYears", "termIssueYear"],
      disability_policy: ["carrier", "stdEliminationDays", "stdBenefitPct", "stdDurationWeeks", "stdMonthlyMax", "ltdEliminationDays", "ltdBenefitPct", "ltdMonthlyMax", "colaRate", "annualPremium", "notes"],
      ltc_policy: ["carrier", "issueYear", "benefitAmount", "eliminationDays", "homeCarePct", "notes"],
      entity: ["trustee", "notes"],
      gift: ["year", "amount", "notes"],
    });
  });

  it("marks the fields that name or own a record", () => {
    const identities = Object.fromEntries(fields.filter((f) => f.field.identity).map((f) => [f.id, f.field.identity]));
    expect(identities).toEqual({
      "client_household.firstName": "name",
      "client_household.lastName": "name",
      "client_household.spouseName": "name",
      "client_household.spouseLastName": "name",
      "family_member.firstName": "name",
      "family_member.lastName": "name",
      "external_beneficiary.name": "name",
      "related_party.firstName": "name",
      "related_party.lastName": "name",
      "account.name": "name",
      "account.owners": "owner",
      "business_account.name": "name",
      "business_account.owners": "owner",
      "stock_option_account.name": "name",
      "stock_option_account.owner": "owner",
      "note_receivable.name": "name",
      "note_receivable.owners": "owner",
      "liability.name": "name",
      "liability.owners": "owner",
      "income.name": "name",
      "income.owner": "owner",
      "expense.name": "name",
      "life_insurance_policy.name": "name",
      "life_insurance_policy.ownerRef": "owner",
      "disability_policy.name": "name",
      "ltc_policy.name": "name",
      "entity.name": "name",
      "revocable_trust.name": "name",
    });
  });

  it("looks a field up by target and key, never through the prototype", () => {
    expect(targetField("account", "value")).toMatchObject({ label: "Current value", kind: "money" });
    expect(targetField("account", "nope")).toBeUndefined();
    expect(targetField("account", "constructor")).toBeUndefined();
  });

  it("never says Spouse in a label", () => {
    const labels = [...TARGET_KINDS.map((t) => TARGETS[t].label), ...fields.map((f) => f.field.label)];
    expect(labels.filter((label) => /spouse/i.test(label))).toEqual([]);
  });
});

describe("the six fields added to the Details field map", () => {
  it("are listed, marked so no Details write sends them where they'd be dropped", () => {
    expect(findField("account", "propertyAddress")).toMatchObject({ kind: "string", appliesTo: "update" });
    expect(findField("liability", "liabilityType")).toMatchObject({
      kind: "enum",
      writable: false,
      enumValues: [...liabilityTypeEnum.enumValues],
    });
    expect(findField("life_insurance_policy", "carrier")).toMatchObject({ kind: "string", writable: false });
    expect(findField("life_insurance_policy", "policyNumberLast4")).toMatchObject({ kind: "string", writable: false });
    expect(findField("will", "executor")).toMatchObject({ kind: "string", writable: false });
    expect(findField("will", "executionDate")).toMatchObject({ kind: "date", writable: false });
  });
});
