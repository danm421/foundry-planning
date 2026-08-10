import { describe, it, expect } from "vitest";
import { accountCategoryEnum, accountSubTypeEnum } from "@/db/schema";
import {
  INTAKE_ACCOUNT_CATEGORY_VALUES,
  INTAKE_ACCOUNT_TYPES,
  defaultSubTypeForCategory,
  deriveIntakeAccountName,
  intakeAccountTypeLabel,
  isSubTypeOfCategory,
  subTypesForCategory,
} from "../account-types";
import { intakeAccountSchema } from "../schema";

describe("intake account taxonomy", () => {
  // The form's values are written straight into `accounts.category` /
  // `accounts.sub_type` by apply. A value outside the pg enum wouldn't fail
  // here or in tsc — it would throw mid-transaction on a real submission.
  it("only offers categories the accounts table accepts", () => {
    for (const category of INTAKE_ACCOUNT_CATEGORY_VALUES) {
      expect(accountCategoryEnum.enumValues).toContain(category);
    }
  });

  it("only offers sub-types the accounts table accepts", () => {
    for (const group of INTAKE_ACCOUNT_TYPES) {
      for (const sub of group.subTypes) {
        expect(accountSubTypeEnum.enumValues).toContain(sub.value);
      }
    }
  });

  it("starts each category on its first sub-type", () => {
    expect(defaultSubTypeForCategory("retirement")).toBe("traditional_ira");
    expect(defaultSubTypeForCategory("education_savings")).toBe("529");
    // Annuity has no split — apply falls back to the column's "other".
    expect(defaultSubTypeForCategory("annuity")).toBeUndefined();
  });

  it("rejects a sub-type from another category", () => {
    expect(isSubTypeOfCategory("retirement", "roth_ira")).toBe(true);
    expect(isSubTypeOfCategory("cash", "roth_ira")).toBe(false);
  });

  it("hides the picker only where there is nothing to pick", () => {
    const splittable = INTAKE_ACCOUNT_TYPES.filter((g) => g.subTypes.length > 1);
    expect(splittable.map((g) => g.value)).toEqual([
      "taxable",
      "cash",
      "retirement",
      "life_insurance",
    ]);
    expect(subTypesForCategory("annuity")).toHaveLength(0);
  });
});

describe("intakeAccountTypeLabel", () => {
  it("reads the sub-type where the client gave one", () => {
    expect(intakeAccountTypeLabel({ category: "retirement", subType: "roth_ira" })).toBe(
      "Roth IRA",
    );
  });

  it("falls back to the category when there is no sub-type", () => {
    expect(intakeAccountTypeLabel({ category: "annuity" })).toBe("Annuity");
    // Pre-picker submissions carry a category only.
    expect(intakeAccountTypeLabel({ category: "retirement" })).toBe("Retirement");
  });

  it("ignores a sub-type the category doesn't offer rather than mislabelling", () => {
    expect(intakeAccountTypeLabel({ category: "cash", subType: "roth_ira" })).toBe(
      "Cash & savings",
    );
  });
});

describe("deriveIntakeAccountName", () => {
  const names = { clientName: "Dana", spouseName: "Alex" };

  it("is type · owner · custodian", () => {
    expect(
      deriveIntakeAccountName(
        { category: "retirement", subType: "roth_ira", owner: "client", custodian: "Fidelity" },
        names,
      ),
    ).toBe("Roth IRA - Dana - Fidelity");
  });

  it("drops the custodian when it wasn't given", () => {
    expect(
      deriveIntakeAccountName({ category: "cash", subType: "checking", owner: "spouse" }, names),
    ).toBe("Checking - Alex");
    expect(
      deriveIntakeAccountName(
        { category: "cash", subType: "checking", owner: "spouse", custodian: "   " },
        names,
      ),
    ).toBe("Checking - Alex");
  });

  it("falls back to the roles before the client has named themselves", () => {
    expect(deriveIntakeAccountName({ category: "taxable", subType: "brokerage" })).toBe(
      "Brokerage - Client",
    );
    expect(
      deriveIntakeAccountName({ category: "taxable", subType: "brokerage", owner: "joint" }),
    ).toBe("Brokerage - Joint");
  });

  it("stays inside the schema's 120-char name limit", () => {
    const name = deriveIntakeAccountName(
      {
        category: "taxable",
        subType: "brokerage",
        owner: "client",
        custodian: "x".repeat(120),
      },
      names,
    );
    expect(name).toHaveLength(120);
    expect(
      intakeAccountSchema.safeParse({
        name,
        category: "taxable",
        subType: "brokerage",
        value: 1,
      }).success,
    ).toBe(true);
  });
});

describe("intakeAccountSchema", () => {
  it("accepts a category/sub-type pair the form offers", () => {
    const parsed = intakeAccountSchema.safeParse({
      name: "Roth IRA - Dana",
      category: "retirement",
      subType: "roth_ira",
      value: 50_000,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a submission from before the picker existed", () => {
    const parsed = intakeAccountSchema.safeParse({
      name: "401k",
      category: "retirement",
      value: 50_000,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.subType).toBeUndefined();
  });

  // The DB's retirement trigger keys on sub_type: a mismatched pair would blow
  // up apply mid-transaction instead of failing validation.
  it("rejects a sub-type that belongs to another category", () => {
    const parsed = intakeAccountSchema.safeParse({
      name: "Checking - Dana",
      category: "cash",
      subType: "traditional_ira",
      value: 5_000,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts the 529 category", () => {
    const parsed = intakeAccountSchema.safeParse({
      name: "529 Plan - Dana",
      category: "education_savings",
      subType: "529",
      value: 20_000,
    });
    expect(parsed.success).toBe(true);
  });
});
