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

  it("ranks an exact-name candidate above a one-typo candidate", () => {
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "taxable", value: 100_000 },
      [
        { ...baseExisting, id: "typo", name: "Schwab Brokrage" },
        { ...baseExisting, id: "exact-name", name: "Schwab Brokerage" },
      ],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates[0].id).toBe("exact-name");
      expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
    }
  });

  it("caps fuzzy candidates at 5 and returns new when no fuzzy hits", () => {
    const result = matchAccount(
      { name: "Apex Capital", category: "taxable", value: 50_000 },
      [],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("returns exact when custodian differs only by a legal suffix", () => {
    const result = matchAccount(
      {
        name: "Fidelity Rollover IRA",
        category: "retirement",
        accountNumberLast4: "9999",
        custodian: "Fidelity",
        value: 250_000,
      },
      [
        {
          id: "acct-fid",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: "9999",
          custodian: "Fidelity Brokerage Services LLC",
          value: 250_000,
        },
      ],
    );
    expect(result).toEqual({ kind: "exact", existingId: "acct-fid" });
  });

  it("returns exact when last4 is unique and neither side names a custodian", () => {
    // Both sides are `retirement`, which is what corroborates the bare last4
    // here — see the two tests below. A unique last4 on its own does not.
    const result = matchAccount(
      { name: "Rollover IRA", category: "retirement", accountNumberLast4: "4321" },
      [
        {
          id: "acct-solo",
          name: "Old IRA",
          category: "retirement",
          accountNumberLast4: "4321",
          custodian: null,
          value: 10_000,
        },
      ],
    );
    expect(result).toEqual({ kind: "exact", existingId: "acct-solo" });
  });

  it("does NOT return exact on a bare last4 when neither category nor name corroborates", () => {
    // Rung 2 asks only that no KNOWN custodian contradicts, so an existing row
    // with a NULL custodian contradicts nothing and four digits decide alone.
    // Four digits collide often, and an `exact` here does not merely mis-link:
    // commit rewrites category, flipping a taxable checking account into a
    // pre-tax retirement account and with it the withdrawal waterfall, RMD
    // eligibility and every tax year of the projection.
    const result = matchAccount(
      {
        name: "Fidelity Rollover IRA",
        category: "retirement",
        accountNumberLast4: "4821",
        custodian: "Fidelity",
        value: 450_000,
      },
      [
        {
          id: "chase",
          name: "Chase Checking",
          category: "cash",
          accountNumberLast4: "4821",
          custodian: null,
          value: 20_000,
        },
      ],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("still returns exact on a bare last4 when the name corroborates across a category mismatch", () => {
    // The other half of the guard's `||`. Category is a scoring input rather
    // than an exclusion precisely because the extractor misclassifies it, so
    // name agreement has to be able to carry the corroboration by itself.
    const result = matchAccount(
      {
        name: "Fidelity Rollover IRA",
        category: "retirement",
        accountNumberLast4: "4821",
      },
      [
        {
          id: "misfiled",
          name: "Fidelity Rollover IRA",
          category: "taxable",
          accountNumberLast4: "4821",
          custodian: null,
          value: 450_000,
        },
      ],
    );
    expect(result).toEqual({ kind: "exact", existingId: "misfiled" });
  });

  it("does NOT return exact when last4 is shared by two candidates and custodian cannot disambiguate", () => {
    const result = matchAccount(
      { name: "Brokerage", category: "taxable", accountNumberLast4: "1111", value: 50_000 },
      [
        {
          id: "a",
          name: "Schwab Brokerage",
          category: "taxable",
          accountNumberLast4: "1111",
          custodian: "Schwab",
          value: 50_000,
        },
        {
          id: "b",
          name: "Fidelity Brokerage",
          category: "taxable",
          accountNumberLast4: "1111",
          custodian: "Fidelity",
          value: 50_000,
        },
      ],
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("still fuzzies when a unique last4 is contradicted by a known custodian", () => {
    const result = matchAccount(
      {
        name: "Fidelity Brokerage",
        category: "taxable",
        accountNumberLast4: "1234",
        custodian: "Fidelity",
        value: 100_000,
      },
      [baseExisting], // Charles Schwab, last4 1234
    );
    expect(result.kind).toBe("fuzzy");
  });

  it("surfaces a candidate whose value moved more than the old 30% window", () => {
    const result = matchAccount(
      {
        name: "Schwab Brokerage",
        category: "taxable",
        value: 200_000, // +100% vs baseExisting
      },
      [baseExisting],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates.map((c) => c.id)).toContain("acct-1");
    }
  });

  it("surfaces a candidate whose category was misclassified by the extractor", () => {
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "cash", value: 100_000 },
      [baseExisting], // taxable
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates.map((c) => c.id)).toContain("acct-1");
    }
  });

  it("still surfaces a candidate when the incoming row has no value", () => {
    // An unknown value scores neutrally rather than excluding the candidate:
    // a statement page that omits the balance is not evidence of a new account.
    const result = matchAccount(
      { name: "Schwab Brokerage", category: "taxable" },
      [baseExisting],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates.map((c) => c.id)).toContain("acct-1");
    }
  });

  it("ranks an owner-agreeing candidate above an owner-disagreeing one", () => {
    const result = matchAccount(
      { name: "Fidelity IRA", category: "retirement", value: 100_000 },
      [
        {
          id: "his",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: 100_000,
          ownerIds: ["fm-john"],
        },
        {
          id: "hers",
          name: "Fidelity IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: 100_000,
          ownerIds: ["fm-jane"],
        },
      ],
      ["fm-jane"],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates[0].id).toBe("hers");
    }
  });

  it("matches condensed names against longer existing names by token overlap", () => {
    const result = matchAccount(
      { name: "Fidelity IRA", category: "retirement", value: 100_000 },
      [
        {
          id: "long",
          name: "Fidelity Rollover IRA",
          category: "retirement",
          accountNumberLast4: null,
          custodian: "Fidelity",
          value: 100_000,
        },
      ],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates[0].id).toBe("long");
    }
  });

  it("returns new when nothing clears the score floor", () => {
    const result = matchAccount(
      { name: "Zzz Unrelated Holding", category: "real_estate", value: 5 },
      [baseExisting],
    );
    expect(result).toEqual({ kind: "new" });
  });

  it("PINS CURRENT CALIBRATION: category + agreeing owner alone admits a zero-name-similarity candidate", () => {
    // Every other "stays new" case above uses neutral ownership or a category
    // mismatch, so this regime was uncovered. It is pinned, NOT endorsed:
    // W_OWNER (0.25) + W_CATEGORY (0.20) is exactly SCORE_FLOOR (0.45) and the
    // admission test is `>=`, so agreement on category and owner alone clears
    // the floor even with zero name overlap and a maximally wrong value. Any
    // future re-weighting will flip this test, which is the point — a
    // recalibration should be a deliberate decision, not a silent drift.
    //
    // Reachability, since the arithmetic alone reads alarming: this calls
    // `matchAccount` directly, so it can hand over owner ids the production
    // caller would withhold. `resolveOwnerIds` forwards ids only for a `"hint"`
    // resolution, so reaching this regime for real takes a registration line
    // that names the candidate's actual owner — evidence, not the model's
    // inferred `owner` enum. That is the trade: 0.45-on-owner-and-category-alone
    // is defensible on evidence and was not on a guess.
    const result = matchAccount(
      // No shared token with "Schwab Brokerage", so nameSimilarity === 0.
      // value 0 against a 100k candidate makes valueProximity === 0.
      { name: "Zzz Unrelated Holding", category: "taxable", value: 0 },
      [{ ...baseExisting, accountNumberLast4: null, ownerIds: ["fm-jane"] }],
      ["fm-jane"],
    );
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].id).toBe("acct-1");
      expect(result.candidates[0].score).toBeCloseTo(0.45, 12);
    }
  });

  it("returns exact when the stored last4 carries stray whitespace", () => {
    // commitAccounts persists `row.accountNumberLast4` untrimmed, so an
    // extraction that emitted " 1234" is stored with the space. Comparing the
    // candidate side raw failed both exact rungs and duplicated the account on
    // every subsequent import.
    const result = matchAccount(
      {
        name: "Schwab Brokerage",
        category: "taxable",
        accountNumberLast4: "1234",
        custodian: "Charles Schwab",
        value: 100_000,
      },
      [{ ...baseExisting, accountNumberLast4: " 1234" }],
    );
    expect(result).toEqual({ kind: "exact", existingId: "acct-1" });
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
