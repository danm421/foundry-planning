import { describe, expect, it } from "vitest";
import type { DeathTransfer, WillResiduaryRecipient } from "@/engine/types";
import { computeDrainAttributions } from "../drain-attribution";

const t = (overrides: Partial<DeathTransfer>): DeathTransfer => ({
  year: 2026,
  deathOrder: 2,
  deceased: "client",
  sourceAccountId: "a-1",
  sourceAccountName: "Brokerage",
  sourceLiabilityId: null,
  sourceLiabilityName: null,
  via: "will",
  recipientKind: "family_member",
  recipientId: "fm-1",
  recipientLabel: "Child A",
  amount: 100_000,
  basis: 50_000,
  resultingAccountId: null,
  resultingLiabilityId: null,
  ...overrides,
});

describe("computeDrainAttributions — pro-rata fallback (no residuary)", () => {
  it("allocates federal tax pro-rata to non-spouse recipients", () => {
    const transfers: DeathTransfer[] = [
      t({ recipientId: "fm-1", amount: 750_000 }),
      t({ recipientId: "fm-2", amount: 250_000 }),
    ];
    const out = computeDrainAttributions({
      deathOrder: 2,
      transfers,
      drainTotals: {
        federal_estate_tax: 100_000,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      },
      residuaryRecipients: [],
    });
    const fed = out.filter((a) => a.drainKind === "federal_estate_tax");
    expect(fed).toHaveLength(2);
    expect(fed.find((a) => a.recipientId === "fm-1")?.amount).toBeCloseTo(
      75_000,
    );
    expect(fed.find((a) => a.recipientId === "fm-2")?.amount).toBeCloseTo(
      25_000,
    );
  });

  it("exempts spouse from federal + state estate tax (marital deduction)", () => {
    const transfers: DeathTransfer[] = [
      t({
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Spouse",
        amount: 800_000,
      }),
      t({ recipientId: "fm-1", amount: 200_000 }),
    ];
    const out = computeDrainAttributions({
      deathOrder: 1,
      transfers,
      drainTotals: {
        federal_estate_tax: 50_000,
        state_estate_tax: 10_000,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      },
      residuaryRecipients: [],
    });
    const fedSpouse = out.find(
      (a) => a.recipientKind === "spouse" && a.drainKind === "federal_estate_tax",
    );
    expect(fedSpouse).toBeUndefined();
    const fedHeir = out.find(
      (a) => a.recipientId === "fm-1" && a.drainKind === "federal_estate_tax",
    );
    expect(fedHeir?.amount).toBeCloseTo(50_000); // 100% of fed lands on the heir
  });

  it("allocates debts pro-rata across ALL recipients including spouse", () => {
    const transfers: DeathTransfer[] = [
      t({ recipientKind: "spouse", recipientId: null, amount: 800_000 }),
      t({ recipientId: "fm-1", amount: 200_000 }),
    ];
    const out = computeDrainAttributions({
      deathOrder: 1,
      transfers,
      drainTotals: {
        federal_estate_tax: 0,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 50_000,
        ird_tax: 0,
      },
      residuaryRecipients: [],
    });
    const debtSpouse = out.find(
      (a) => a.recipientKind === "spouse" && a.drainKind === "debts_paid",
    );
    const debtHeir = out.find(
      (a) => a.recipientId === "fm-1" && a.drainKind === "debts_paid",
    );
    expect(debtSpouse?.amount).toBeCloseTo(40_000);
    expect(debtHeir?.amount).toBeCloseTo(10_000);
  });
});

describe("computeDrainAttributions — residuary-first", () => {
  it("absorbs full drain when residuary share covers it", () => {
    const transfers: DeathTransfer[] = [
      t({ recipientId: "fm-residue", amount: 600_000 }),
      t({ recipientId: "fm-specific", amount: 400_000 }),
    ];
    const residuary: WillResiduaryRecipient[] = [
      {
        recipientKind: "family_member",
        recipientId: "fm-residue",
        percentage: 100,
        sortOrder: 0,
      },
    ];
    const out = computeDrainAttributions({
      deathOrder: 2,
      transfers,
      drainTotals: {
        federal_estate_tax: 100_000,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      },
      residuaryRecipients: residuary,
    });
    const fedResidue = out.find(
      (a) =>
        a.recipientId === "fm-residue" && a.drainKind === "federal_estate_tax",
    );
    const fedSpecific = out.find(
      (a) =>
        a.recipientId === "fm-specific" && a.drainKind === "federal_estate_tax",
    );
    expect(fedResidue?.amount).toBeCloseTo(100_000);
    expect(fedSpecific).toBeUndefined();
  });

  it("overflows pro-rata when residuary share is exhausted", () => {
    // Residuary recipient receives only $50k; drain is $100k → overflow $50k
    // pro-rata across remaining non-spouse recipients.
    const transfers: DeathTransfer[] = [
      t({ recipientId: "fm-residue", amount: 50_000 }),
      t({ recipientId: "fm-other-1", amount: 600_000 }),
      t({ recipientId: "fm-other-2", amount: 400_000 }),
    ];
    const residuary: WillResiduaryRecipient[] = [
      {
        recipientKind: "family_member",
        recipientId: "fm-residue",
        percentage: 100,
        sortOrder: 0,
      },
    ];
    const out = computeDrainAttributions({
      deathOrder: 2,
      transfers,
      drainTotals: {
        federal_estate_tax: 100_000,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      },
      residuaryRecipients: residuary,
    });
    const fedResidue = out.find(
      (a) =>
        a.recipientId === "fm-residue" && a.drainKind === "federal_estate_tax",
    );
    const fedOther1 = out.find(
      (a) =>
        a.recipientId === "fm-other-1" && a.drainKind === "federal_estate_tax",
    );
    const fedOther2 = out.find(
      (a) =>
        a.recipientId === "fm-other-2" && a.drainKind === "federal_estate_tax",
    );
    expect(fedResidue?.amount).toBeCloseTo(50_000);
    expect(fedOther1?.amount).toBeCloseTo(30_000); // 600/1000 × 50k
    expect(fedOther2?.amount).toBeCloseTo(20_000); // 400/1000 × 50k
  });

  it("splits across multi-recipient residuary in proportion to percentage", () => {
    const transfers: DeathTransfer[] = [
      t({ recipientId: "fm-a", amount: 600_000 }),
      t({ recipientId: "fm-b", amount: 400_000 }),
    ];
    const residuary: WillResiduaryRecipient[] = [
      {
        recipientKind: "family_member",
        recipientId: "fm-a",
        percentage: 70,
        sortOrder: 0,
      },
      {
        recipientKind: "family_member",
        recipientId: "fm-b",
        percentage: 30,
        sortOrder: 1,
      },
    ];
    const out = computeDrainAttributions({
      deathOrder: 2,
      transfers,
      drainTotals: {
        federal_estate_tax: 100_000,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      },
      residuaryRecipients: residuary,
    });
    const fedA = out.find(
      (a) => a.recipientId === "fm-a" && a.drainKind === "federal_estate_tax",
    );
    const fedB = out.find(
      (a) => a.recipientId === "fm-b" && a.drainKind === "federal_estate_tax",
    );
    expect(fedA?.amount).toBeCloseTo(70_000);
    expect(fedB?.amount).toBeCloseTo(30_000);
  });

  it("sum-per-drain-kind matches the input drainTotals", () => {
    const transfers: DeathTransfer[] = [
      t({ recipientId: "fm-1", amount: 1_000_000 }),
      t({ recipientId: "fm-2", amount: 500_000 }),
    ];
    const drainTotals = {
      federal_estate_tax: 100_000,
      state_estate_tax: 50_000,
      admin_expenses: 30_000,
      debts_paid: 20_000,
      ird_tax: 0,
    };
    const out = computeDrainAttributions({
      deathOrder: 2,
      transfers,
      drainTotals,
      residuaryRecipients: [],
    });
    for (const kind of [
      "federal_estate_tax",
      "state_estate_tax",
      "admin_expenses",
      "debts_paid",
      "ird_tax",
    ] as const) {
      const sum = out
        .filter((a) => a.drainKind === kind)
        .reduce((s, a) => s + a.amount, 0);
      expect(sum).toBeCloseTo(drainTotals[kind]);
    }
  });

  it("returns empty array when all drainTotals are zero", () => {
    const transfers: DeathTransfer[] = [
      t({ recipientId: "fm-1", amount: 100_000 }),
    ];
    const out = computeDrainAttributions({
      deathOrder: 2,
      transfers,
      drainTotals: {
        federal_estate_tax: 0,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      },
      residuaryRecipients: [],
    });
    expect(out).toEqual([]);
  });
});
