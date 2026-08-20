import { describe, it, expect } from "vitest";
import type { ClientData, Liability } from "@/engine/types";
import { applyMutations } from "../apply-mutations";
import { computeLiabilities } from "@/engine/liabilities";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { isBaseSavableMutation } from "../mutations-to-base-updates";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";
import { mutationKey } from "../types";
import type { SolverMutation } from "../types";
import type { DebtPaydownRow } from "../debt-paydown";

const LIAB: Liability = {
  id: "liab-1",
  name: "Primary Mortgage",
  balance: 275_000,
  interestRate: 0.06,
  monthlyPayment: 1798.65,
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  balanceAsOfYear: 2026,
  balanceAsOfMonth: 1,
  liabilityType: "mortgage",
  extraPayments: [],
  owners: [],
};

const ROW: DebtPaydownRow = {
  liabilityId: "liab-1",
  frequency: "monthly",
  amount: 500,
  startYear: 2027,
  endYear: 2029,
};

function baseTree(liabilities: Liability[] = [LIAB]): ClientData {
  return {
    client: {} as never,
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses: [],
    liabilities,
    planSettings: { planStartYear: 2026 } as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

describe("debt-paydown mutation", () => {
  it("keys on the liability, so one loan carries at most one paydown", () => {
    expect(mutationKey({ kind: "debt-paydown", liabilityId: "liab-1", value: ROW })).toBe(
      "debt-paydown:liab-1",
    );
  });

  it("validates over the wire (and rejects a bad frequency)", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "debt-paydown", liabilityId: "liab-1", value: ROW })
        .success,
    ).toBe(true);
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "debt-paydown", liabilityId: "liab-1", value: null })
        .success,
    ).toBe(true);
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({
        kind: "debt-paydown",
        liabilityId: "liab-1",
        value: { ...ROW, frequency: "weekly" },
      }).success,
    ).toBe(false);
  });

  it("applies onto the liability's extraPayments", () => {
    const out = applyMutations(baseTree(), [
      { kind: "debt-paydown", liabilityId: "liab-1", value: ROW },
    ]);
    const extras = out.liabilities[0].extraPayments;
    expect(extras.map((e) => e.year)).toEqual([2027, 2028, 2029]);
    expect(extras.every((e) => e.type === "per_payment" && e.amount === 500)).toBe(true);
  });

  it("replaces rather than stacks on re-apply, and clears on null", () => {
    const once = applyMutations(baseTree(), [
      { kind: "debt-paydown", liabilityId: "liab-1", value: ROW },
    ]);
    const twice = applyMutations(once, [
      { kind: "debt-paydown", liabilityId: "liab-1", value: { ...ROW, amount: 900 } },
    ]);
    expect(twice.liabilities[0].extraPayments).toHaveLength(3);
    expect(twice.liabilities[0].extraPayments.every((e) => e.amount === 900)).toBe(true);

    const cleared = applyMutations(twice, [
      { kind: "debt-paydown", liabilityId: "liab-1", value: null },
    ]);
    expect(cleared.liabilities[0].extraPayments).toEqual([]);
  });

  it("leaves other liabilities untouched", () => {
    const other: Liability = { ...LIAB, id: "liab-2", name: "Car Loan" };
    const out = applyMutations(baseTree([LIAB, other]), [
      { kind: "debt-paydown", liabilityId: "liab-1", value: ROW },
    ]);
    expect(out.liabilities.find((l) => l.id === "liab-2")!.extraPayments).toEqual([]);
  });

  it("round-trips as a liability edit in a saved scenario", () => {
    const drafts = mutationsToScenarioChanges(baseTree(), "client-1", [
      { kind: "debt-paydown", liabilityId: "liab-1", value: ROW },
    ]);
    const draft = drafts.find((d) => d.targetKind === "liability");
    expect(draft).toBeDefined();
    expect(draft!.opType).toBe("edit");
    expect(draft!.targetId).toBe("liab-1");
    const payload = draft!.payload as { extraPayments: { from: unknown[]; to: unknown[] } };
    expect(payload.extraPayments.from).toEqual([]);
    expect(payload.extraPayments.to).toHaveLength(3);
  });

  it("emits nothing when the paydown is a no-op vs. base", () => {
    const drafts = mutationsToScenarioChanges(baseTree(), "client-1", [
      { kind: "debt-paydown", liabilityId: "liab-1", value: null },
    ]);
    expect(drafts.filter((d) => d.targetKind === "liability")).toHaveLength(0);
  });

  it("is gated out of Save-to-base (extra payments are a child table)", () => {
    const m: SolverMutation = { kind: "debt-paydown", liabilityId: "liab-1", value: ROW };
    expect(isBaseSavableMutation(m)).toBe(false);
  });
});

describe("debt-paydown cash flow", () => {
  it("costs the plan real money — the paydown lands in the liability outflow", () => {
    const withPlan = applyMutations(baseTree(), [
      { kind: "debt-paydown", liabilityId: "liab-1", value: { ...ROW, endYear: 2027 } },
    ]);

    const before = computeLiabilities(baseTree().liabilities, 2027);
    const after = computeLiabilities(withPlan.liabilities, 2027);

    // $500/mo extra for 12 months, on top of the unchanged scheduled payment.
    expect(after.totalPayment - before.totalPayment).toBeCloseTo(6_000, 0);
    expect(after.byLiability["liab-1"] - before.byLiability["liab-1"]).toBeCloseTo(6_000, 0);

    // …and it buys down principal, so the balance ends the year lower.
    expect(after.updatedLiabilities[0].balance).toBeLessThan(
      before.updatedLiabilities[0].balance,
    );
    // …while the interest deduction shrinks rather than growing.
    expect(after.interestByLiability["liab-1"]).toBeLessThan(
      before.interestByLiability["liab-1"],
    );
  });
});
