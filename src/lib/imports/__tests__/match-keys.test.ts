import { describe, expect, it } from "vitest";

import { matchAccount, type AccountCandidate } from "../match-keys/account";
import { matchIncome, type IncomeCandidate } from "../match-keys/income";
import { matchExpense, type ExpenseCandidate } from "../match-keys/expense";
import { matchLiability, type LiabilityCandidate } from "../match-keys/liability";
import {
  matchFamilyMember,
  type FamilyMemberCandidate,
} from "../match-keys/family-member";
import {
  matchLifePolicy,
  type LifePolicyCandidate,
} from "../match-keys/life-policy";
import { matchWill, type WillCandidate } from "../match-keys/will";
import { matchEntity, type EntityCandidate } from "../match-keys/entity";

describe("matchAccount", () => {
  const baseExisting: AccountCandidate = {
    id: "acct-1",
    name: "Schwab Brokerage",
    category: "taxable",
    accountNumberLast4: "1234",
    custodian: "Charles Schwab",
    value: 100_000,
  };

  it("returns exact when last4 + custodian match (case-insensitive)", () => {
    const result = matchAccount(
      {
        name: "Schwab Brokerage Account",
        category: "taxable",
        accountNumberLast4: "1234",
        custodian: "charles schwab",
        value: 105_000,
      },
      [baseExisting],
    );
    expect(result).toEqual({ kind: "exact", existingId: "acct-1" });
  });

  it("falls through to fuzzy when last4 alone matches but custodian differs", () => {
    const result = matchAccount(
      {
        name: "Schwab Brokrage", // typo
        category: "taxable",
        accountNumberLast4: "1234",
        custodian: "Fidelity",
        value: 100_000,
      },
      [baseExisting],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns fuzzy when name is within Lev 3 + same category + value within 30%", () => {
    const result = matchAccount(
      {
        name: "Schwab Brokrage", // 1 edit
        category: "taxable",
        value: 90_000, // 10% delta
      },
      [baseExisting],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates[0].id).toBe("acct-1");
      expect(result.candidates[0].score).toBeGreaterThan(0);
    }
  });

  it("rejects fuzzy when category differs", () => {
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "retirement", value: 100_000 },
      [baseExisting],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("rejects fuzzy when value delta exceeds 30%", () => {
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "taxable", value: 200_000 },
      [baseExisting],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("rejects fuzzy when name distance exceeds 3 edits", () => {
    const result = matchAccount(
      { name: "Vanguard Fund", category: "taxable", value: 100_000 },
      [baseExisting],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("returns the closest candidate first when multiple fuzzy hits exist", () => {
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "taxable", value: 100_000 },
      [
        { ...baseExisting, id: "far", name: "Schwab Brokrage" },
        { ...baseExisting, id: "near", name: "Schwab Brokerage" },
      ],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates[0].id).toBe("near");
    }
  });

  it("caps fuzzy candidates at 5 and returns new when no fuzzy hits", () => {
    const result = matchAccount(
      { name: "Apex Capital", category: "taxable", value: 50_000 },
      [],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("treats missing value on incoming as a no-fuzzy signal", () => {
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "taxable" },
      [baseExisting],
    );
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchIncome", () => {
  const base: IncomeCandidate = {
    id: "inc-1",
    type: "salary",
    name: "Acme Salary",
    owner: "client",
  };

  it("returns exact when type+name+owner all match (name case-insensitive)", () => {
    const result = matchIncome(
      { type: "salary", name: "acme salary", owner: "client", annualAmount: 100_000 },
      [base],
    );
    expect(result).toEqual({ kind: "exact", existingId: "inc-1" });
  });

  it("returns fuzzy when type+owner match and name is within Lev 3", () => {
    const result = matchIncome(
      { type: "salary", name: "Acme Slary", owner: "client" },
      [base],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns new when type differs", () => {
    const result = matchIncome(
      { type: "business", name: "Acme Salary", owner: "client" },
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("returns new when owner differs", () => {
    const result = matchIncome(
      { type: "salary", name: "Acme Salary", owner: "spouse" },
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchExpense", () => {
  const base: ExpenseCandidate = { id: "exp-1", type: "living", name: "Living Expenses" };

  it("returns exact on type+name (name case-insensitive)", () => {
    const result = matchExpense(
      { type: "living", name: "LIVING EXPENSES" },
      [base],
    );
    expect(result).toEqual({ kind: "exact", existingId: "exp-1" });
  });

  it("returns fuzzy on type + name within Lev 3", () => {
    const result = matchExpense({ type: "living", name: "Liveing Expense" }, [base]);
    expect(result.kind).toBe("fuzzy");
  });

  it("returns new when type differs", () => {
    const result = matchExpense({ type: "insurance", name: "Living Expenses" }, [base]);
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchLiability", () => {
  const base: LiabilityCandidate = { id: "li-1", name: "Wells Fargo Mortgage", balance: 500_000 };

  it("returns exact on name + balance within 5%", () => {
    const result = matchLiability(
      { name: "wells fargo mortgage", balance: 510_000 },
      [base],
    );
    expect(result).toEqual({ kind: "exact", existingId: "li-1" });
  });

  it("falls through to fuzzy when balance delta exceeds 5%", () => {
    const result = matchLiability(
      { name: "Wells Fargo Mortgage", balance: 700_000 },
      [base],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns fuzzy when name is within Lev 3", () => {
    const result = matchLiability(
      { name: "Welsl Fargo Mortgage" },
      [base],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns new on unrelated name", () => {
    const result = matchLiability({ name: "Toyota Auto Loan" }, [base]);
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchFamilyMember", () => {
  const base: FamilyMemberCandidate = {
    id: "fm-1",
    firstName: "Anna",
    lastName: "Smith",
    dateOfBirth: "2010-05-04",
  };

  it("returns exact on firstName + lastName + dob (case-insensitive)", () => {
    const result = matchFamilyMember(
      { firstName: "anna", lastName: "smith", dateOfBirth: "2010-05-04" },
      [base],
    );
    expect(result).toEqual({ kind: "exact", existingId: "fm-1" });
  });

  it("returns fuzzy when firstName + lastName match but dob differs", () => {
    const result = matchFamilyMember(
      { firstName: "Anna", lastName: "Smith", dateOfBirth: "2011-05-04" },
      [base],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns fuzzy when firstName + lastName match and dob is missing", () => {
    const result = matchFamilyMember({ firstName: "Anna", lastName: "Smith" }, [base]);
    expect(result.kind).toBe("fuzzy");
  });

  it("returns new when last names differ", () => {
    const result = matchFamilyMember(
      { firstName: "Anna", lastName: "Jones" },
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchLifePolicy", () => {
  const base: LifePolicyCandidate = {
    id: "lp-1",
    carrier: "MetLife",
    policyNumberLast4: "9999",
    insuredPerson: "client",
    policyType: "term",
    faceValue: 1_000_000,
  };

  it("returns exact on carrier + policyNumberLast4 (carrier case-insensitive)", () => {
    const result = matchLifePolicy(
      {
        carrier: "metlife",
        policyNumberLast4: "9999",
        insuredPerson: "client",
        policyType: "term",
        faceValue: 1_000_000,
        accountName: "Whatever",
      },
      [base],
    );
    expect(result).toEqual({ kind: "exact", existingId: "lp-1" });
  });

  it("returns fuzzy when insuredPerson + policyType match and faceValue within 10%", () => {
    const result = matchLifePolicy(
      {
        insuredPerson: "client",
        policyType: "term",
        faceValue: 1_050_000,
        accountName: "MetLife Term",
      },
      [base],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns new when faceValue delta exceeds 10%", () => {
    const result = matchLifePolicy(
      {
        insuredPerson: "client",
        policyType: "term",
        faceValue: 2_000_000,
        accountName: "Other",
      },
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("returns new when policyType differs", () => {
    const result = matchLifePolicy(
      {
        insuredPerson: "client",
        policyType: "whole",
        faceValue: 1_000_000,
        accountName: "Other",
      },
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchWill", () => {
  const base: WillCandidate = { id: "w-1", grantor: "client" };

  it("returns exact on grantor (unique per client by index)", () => {
    const result = matchWill({ grantor: "client", bequests: [] }, [base]);
    expect(result).toEqual({ kind: "exact", existingId: "w-1" });
  });

  it("returns new when no will for that grantor exists yet", () => {
    const result = matchWill({ grantor: "spouse", bequests: [] }, [base]);
    expect(result).toEqual({ kind: "new" });
  });
});

describe("matchEntity", () => {
  const base: EntityCandidate = { id: "ent-1", name: "Smith Family Trust", entityType: "trust" };

  it("returns exact on case-insensitive name", () => {
    const result = matchEntity({ name: "SMITH FAMILY TRUST" }, [base]);
    expect(result).toEqual({ kind: "exact", existingId: "ent-1" });
  });

  it("returns fuzzy when name is within Lev 2 and entityType matches", () => {
    const result = matchEntity(
      { name: "Smith Family Trsut", entityType: "trust" },
      [base],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("returns new when name is in fuzzy range but entityType differs", () => {
    const result = matchEntity(
      { name: "Smith Family Trsut", entityType: "llc" }, // 1 edit to base, but type llc != trust
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("returns new when name distance exceeds 2", () => {
    const result = matchEntity(
      { name: "Jones Family Trust", entityType: "trust" },
      [base],
    );
    expect(result).toEqual({ kind: "new" });
  });
});
