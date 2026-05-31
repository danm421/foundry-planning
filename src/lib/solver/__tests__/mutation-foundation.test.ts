import { describe, it, expect } from "vitest";
import { mutationKey } from "../types";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";
import type { Account, SavingsRule } from "@/engine/types";

const ACCOUNT: Account = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "John — Taxable",
  category: "taxable",
  subType: "brokerage",
  value: 0,
  basis: 0,
  growthRate: 0.06,
  rmdEnabled: false,
  titlingType: "jtwros",
  owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 100 }],
};

const RULE: SavingsRule = {
  id: "22222222-2222-4222-8222-222222222222",
  accountId: ACCOUNT.id,
  annualAmount: 12000,
  isDeductible: false,
  startYear: 2026,
  endYear: 2045,
};

describe("account/savings-rule upsert mutations", () => {
  it("produces stable keys", () => {
    expect(mutationKey({ kind: "account-upsert", id: ACCOUNT.id, value: ACCOUNT }))
      .toBe(`account-upsert:${ACCOUNT.id}`);
    expect(mutationKey({ kind: "savings-rule-upsert", id: RULE.id, value: RULE }))
      .toBe(`savings-rule-upsert:${RULE.id}`);
  });

  it("validates via the Zod schema (add + remove)", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "account-upsert", id: ACCOUNT.id, value: ACCOUNT }).success).toBe(true);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "account-upsert", id: ACCOUNT.id, value: null }).success).toBe(true);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "savings-rule-upsert", id: RULE.id, value: RULE }).success).toBe(true);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "savings-rule-upsert", id: RULE.id, value: null }).success).toBe(true);
  });
});
