// src/lib/fact-finder/__tests__/enums.test.ts
import { describe, expect, it } from "vitest";
import {
  ANNUITY_TAX,
  CASH_TYPE,
  EXPENSE_TYPE,
  GIFT_FROM,
  INCOME_OWNER,
  INCOME_TYPE,
  INSURED,
  OWNER,
  OWNER_PERSON,
  POLICY_TYPE,
  PROPERTY_TYPE,
  RETIRE_TYPE,
  TAXABLE_TYPE,
} from "../schema";
import {
  ANNUITY_TAX_MAP,
  CASH_TYPE_MAP,
  EXPENSE_TYPE_MAP,
  GIFT_FROM_MAP,
  INCOME_OWNER_MAP,
  INCOME_TYPE_MAP,
  INSURED_MAP,
  LIFE_POLICY_TYPE_MAP,
  OWNER_MAP,
  PERSON_MAP,
  PROPERTY_TYPE_MAP,
  RETIRE_TYPE_MAP,
  TAXABLE_TYPE_MAP,
  labelFor,
  valueFor,
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
