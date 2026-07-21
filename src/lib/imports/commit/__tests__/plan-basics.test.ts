import { describe, it, expect, vi, beforeEach } from "vitest";
import { commitPlanBasics } from "../plan-basics";
import { emptyResult } from "../types";
import { clients, expenses, incomes } from "@/db/schema";

/**
 * `calls` records every `update(table).set(patch).where(cond)` in call order,
 * keyed by table identity so tests can assert which table a given patch
 * targeted (needed once more than one write path is exercised in a single
 * test). `updates` stays a flat list of patches — unchanged shape — so the
 * brief's original three tests keep working untouched.
 *
 * `seed.expenseSlots` lets a test seed the rows the living-expense-slot
 * `select()` returns; every other `select()` (there are none today besides
 * that one) falls back to `[]`, matching the original fake's behavior.
 */
function fakeTx(seed: { expenseSlots?: { id: string; name: string }[] } = {}) {
  const updates: Record<string, unknown>[] = [];
  const calls: { table: unknown; patch: Record<string, unknown> }[] = [];
  const tx = {
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        calls.push({ table, patch: v });
        return { where: async () => undefined };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: async () => (table === expenses ? (seed.expenseSlots ?? []) : []),
      }),
    }),
  };
  return { tx, updates, calls };
}

const CTX = { clientId: "c1", scenarioId: "s1", orgId: "f1" } as never;

beforeEach(() => vi.clearAllMocks());

describe("commitPlanBasics", () => {
  it("writes the client horizon columns from stated values", async () => {
    const { tx, updates } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: 65, provenance: "stated" },
        lifeExpectancy: { value: 92, provenance: "stated" },
        spouseRetirementAge: { value: 66, provenance: "stated" },
        spouseLifeExpectancy: { value: 90, provenance: "stated" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [],
      },
    } as never, CTX);

    expect(updates[0]).toMatchObject({
      retirementAge: 65, lifeExpectancy: 92,
      spouseRetirementAge: 66, spouseLifeExpectancy: 90,
    });
  });

  it("commits a null field as NO CHANGE rather than writing 0", async () => {
    const { tx, updates } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: null, provenance: "derived" },
        lifeExpectancy: { value: null, provenance: "derived" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [],
      },
    } as never, CTX);

    // Nothing to write at all — no client update issued.
    expect(updates).toHaveLength(0);
  });

  it("is a no-op when the payload carries no planBasics", async () => {
    const { tx, updates } = fakeTx();
    const res = await commitPlanBasics(tx as never, {} as never, CTX);
    expect(res).toEqual(emptyResult());
    expect(updates).toHaveLength(0);
  });

  it("stamps updatedAt on the client row when it writes horizon columns", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: 65, provenance: "stated" },
        lifeExpectancy: { value: 92, provenance: "stated" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [],
      },
    } as never, CTX);

    const clientCall = calls.find((c) => c.table === clients);
    expect(clientCall?.patch.updatedAt).toBeInstanceOf(Date);
  });

  it("routes a current-slot and a retirement-slot pair to the right field by name, stamping updatedAt", async () => {
    // Order deliberately mismatched from natural current-then-retirement order,
    // so a passing assertion proves name-based routing, not incidental order.
    const { tx, calls } = fakeTx({
      expenseSlots: [
        { id: "slot-retirement", name: "Retirement Living Expenses" },
        { id: "slot-current", name: "Current Living Expenses" },
      ],
    });
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: null, provenance: "derived" },
        lifeExpectancy: { value: null, provenance: "derived" },
        currentLivingSpending: { value: 80000, provenance: "stated" },
        retirementLivingSpending: { value: 60000, provenance: "stated" },
        socialSecurity: [],
      },
    } as never, CTX);

    const expenseCalls = calls.filter((c) => c.table === expenses);
    expect(expenseCalls).toHaveLength(2);
    // Loop preserves select() order: slot-retirement first, slot-current second.
    expect(expenseCalls[0].patch).toMatchObject({ annualAmount: "60000" });
    expect(expenseCalls[0].patch.updatedAt).toBeInstanceOf(Date);
    expect(expenseCalls[1].patch).toMatchObject({ annualAmount: "80000" });
    expect(expenseCalls[1].patch.updatedAt).toBeInstanceOf(Date);
  });

  it("skips a null-valued slot entirely rather than writing 0", async () => {
    const { tx, calls } = fakeTx({
      expenseSlots: [
        { id: "slot-current", name: "Current Living Expenses" },
        { id: "slot-retirement", name: "Retirement Living Expenses" },
      ],
    });
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: null, provenance: "derived" },
        lifeExpectancy: { value: null, provenance: "derived" },
        currentLivingSpending: { value: 50000, provenance: "stated" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [],
      },
    } as never, CTX);

    const expenseCalls = calls.filter((c) => c.table === expenses);
    expect(expenseCalls).toHaveLength(1);
    expect(expenseCalls[0].patch).toMatchObject({ annualAmount: "50000" });
    // No write ever mentions "0" for the untouched retirement slot.
    expect(expenseCalls.some((c) => c.patch.annualAmount === "0")).toBe(false);
  });

  it("writes annualAmount/claimingAge for a Social Security row, stamping updatedAt", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: null, provenance: "derived" },
        lifeExpectancy: { value: null, provenance: "derived" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [
          {
            owner: "client",
            pia: { value: 24000, provenance: "stated" },
            claimingAge: { value: 67, provenance: "stated" },
          },
        ],
      },
    } as never, CTX);

    const incomeCalls = calls.filter((c) => c.table === incomes);
    expect(incomeCalls).toHaveLength(1);
    expect(incomeCalls[0].patch).toMatchObject({ annualAmount: "24000", claimingAge: 67 });
    expect(incomeCalls[0].patch.updatedAt).toBeInstanceOf(Date);
  });

  it("skips a Social Security row with no non-null fields (no update issued)", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: null, provenance: "derived" },
        lifeExpectancy: { value: null, provenance: "derived" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [
          {
            owner: "spouse",
            pia: { value: null, provenance: "derived" },
            claimingAge: { value: null, provenance: "derived" },
          },
        ],
      },
    } as never, CTX);

    expect(calls.filter((c) => c.table === incomes)).toHaveLength(0);
  });
});
