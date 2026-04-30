import { describe, expect, it } from "vitest";

import {
  annotatePayload,
  emptyCandidates,
  runMatchingPass,
  type MatchCandidates,
} from "../match";
import type { Annotated, ImportPayload } from "../types";
import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedWill,
} from "@/lib/extraction/types";

function payloadFixture(overrides: Partial<ImportPayload> = {}): ImportPayload {
  return {
    dependents: [],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    warnings: [],
    ...overrides,
  };
}

function annotated<T extends object>(row: T): Annotated<T> {
  return { ...row, match: { kind: "new" } };
}

describe("annotatePayload", () => {
  it("annotates each entity-array in parallel using the right match-key module", () => {
    const account: Annotated<ExtractedAccount> = annotated({
      name: "Schwab Brokerage",
      category: "taxable",
      accountNumberLast4: "1234",
      custodian: "Charles Schwab",
      value: 100_000,
    });
    const income: Annotated<ExtractedIncome> = annotated({
      type: "salary",
      name: "Acme Salary",
      owner: "client",
    });
    const expense: Annotated<ExtractedExpense> = annotated({
      type: "living",
      name: "Living Expenses",
    });
    const liability: Annotated<ExtractedLiability> = annotated({
      name: "Wells Fargo Mortgage",
      balance: 500_000,
    });
    const dependent: Annotated<ExtractedDependent> = annotated({
      firstName: "Anna",
      lastName: "Smith",
      dateOfBirth: "2010-05-04",
    });
    const policy: Annotated<ExtractedLifePolicy> = annotated({
      carrier: "MetLife",
      policyNumberLast4: "9999",
      insuredPerson: "client",
      policyType: "term",
      faceValue: 1_000_000,
      accountName: "MetLife Term",
    });
    const will: Annotated<ExtractedWill> = annotated({ grantor: "client", bequests: [] });
    const entity: Annotated<ExtractedEntity> = annotated({
      name: "Smith Family Trust",
      entityType: "trust",
    });

    const payload: ImportPayload = payloadFixture({
      accounts: [account],
      incomes: [income],
      expenses: [expense],
      liabilities: [liability],
      dependents: [dependent],
      lifePolicies: [policy],
      wills: [will],
      entities: [entity],
    });

    const candidates: MatchCandidates = {
      accounts: [
        {
          id: "acct-1",
          name: "Schwab Brokerage",
          category: "taxable",
          accountNumberLast4: "1234",
          custodian: "Charles Schwab",
          value: 100_000,
        },
      ],
      incomes: [{ id: "inc-1", type: "salary", name: "Acme Salary", owner: "client" }],
      expenses: [{ id: "exp-1", type: "living", name: "Living Expenses" }],
      liabilities: [{ id: "li-1", name: "Wells Fargo Mortgage", balance: 500_000 }],
      familyMembers: [
        { id: "fm-1", firstName: "Anna", lastName: "Smith", dateOfBirth: "2010-05-04" },
      ],
      lifePolicies: [
        {
          id: "lp-1",
          carrier: "MetLife",
          policyNumberLast4: "9999",
          insuredPerson: "client",
          policyType: "term",
          faceValue: 1_000_000,
        },
      ],
      wills: [{ id: "w-1", grantor: "client" }],
      entities: [{ id: "ent-1", name: "Smith Family Trust", entityType: "trust" }],
    };

    const result = annotatePayload(payload, candidates);

    expect(result.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
    expect(result.incomes[0].match).toEqual({ kind: "exact", existingId: "inc-1" });
    expect(result.expenses[0].match).toEqual({ kind: "exact", existingId: "exp-1" });
    expect(result.liabilities[0].match).toEqual({ kind: "exact", existingId: "li-1" });
    expect(result.dependents[0].match).toEqual({ kind: "exact", existingId: "fm-1" });
    expect(result.lifePolicies[0].match).toEqual({ kind: "exact", existingId: "lp-1" });
    expect(result.wills[0].match).toEqual({ kind: "exact", existingId: "w-1" });
    expect(result.entities[0].match).toEqual({ kind: "exact", existingId: "ent-1" });
  });

  it("preserves singleton primary/spouse and warnings unchanged", () => {
    const payload: ImportPayload = payloadFixture({
      primary: { firstName: "Jordan" },
      spouse: { firstName: "Riley" },
      warnings: ["something to remember"],
    });
    const result = annotatePayload(payload, emptyCandidates());
    expect(result.primary).toEqual({ firstName: "Jordan" });
    expect(result.spouse).toEqual({ firstName: "Riley" });
    expect(result.warnings).toEqual(["something to remember"]);
  });

  it('falls back to { kind: "new" } when no candidates are available', () => {
    const payload: ImportPayload = payloadFixture({
      accounts: [
        annotated({
          name: "Apex Capital",
          category: "taxable",
          value: 10_000,
        }),
      ],
    });
    const result = annotatePayload(payload, emptyCandidates());
    expect(result.accounts[0].match).toEqual({ kind: "new" });
  });

  it("does not mutate the input payload", () => {
    const account = annotated({
      name: "Schwab",
      category: "taxable" as const,
      value: 1,
    });
    const payload: ImportPayload = payloadFixture({ accounts: [account] });
    annotatePayload(payload, emptyCandidates());
    expect(account.match).toEqual({ kind: "new" });
  });
});

describe("runMatchingPass — onboarding mode", () => {
  it("short-circuits without loading from DB and returns the payload unchanged", async () => {
    const payload: ImportPayload = payloadFixture({
      accounts: [
        annotated({
          name: "Schwab Brokerage",
          category: "taxable",
          accountNumberLast4: "1234",
          custodian: "Charles Schwab",
          value: 100_000,
        }),
      ],
    });
    const result = await runMatchingPass({
      payload,
      clientId: "client-1",
      scenarioId: "scenario-1",
      mode: "onboarding",
    });
    expect(result).toBe(payload);
    expect(result.accounts[0].match).toEqual({ kind: "new" });
  });
});
