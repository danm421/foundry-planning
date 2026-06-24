// src/lib/portal/__tests__/portal-networth.test.ts
import { describe, it, expect } from "vitest";
import {
  householdOwnedShare,
  summarizeNetWorth,
  buildPortalLiabilityRows,
} from "@/lib/portal/portal-networth";

const roles = { fmA: "client", fmB: "spouse", fmC: "child" };

describe("householdOwnedShare", () => {
  it("sums client + spouse family-member shares", () => {
    expect(
      householdOwnedShare(
        [
          { kind: "family_member", familyMemberId: "fmA", entityId: null, percent: 0.5 },
          { kind: "family_member", familyMemberId: "fmB", entityId: null, percent: 0.5 },
        ],
        roles,
      ),
    ).toBe(1);
  });
  it("excludes entity owners and non-client/spouse family members", () => {
    expect(
      householdOwnedShare(
        [
          { kind: "entity", familyMemberId: null, entityId: "e1", percent: 0.6 },
          { kind: "family_member", familyMemberId: "fmC", entityId: null, percent: 0.4 },
        ],
        roles,
      ),
    ).toBe(0);
  });
  it("clamps to [0,1]", () => {
    expect(
      householdOwnedShare(
        [{ kind: "family_member", familyMemberId: "fmA", entityId: null, percent: 1.4 }],
        roles,
      ),
    ).toBe(1);
  });
});

describe("summarizeNetWorth", () => {
  it("computes netWorth = assets - debt", () => {
    expect(summarizeNetWorth({ assets: 1000, debt: 250 })).toEqual({
      assets: 1000,
      debt: 250,
      netWorth: 750,
    });
  });
});

describe("buildPortalLiabilityRows", () => {
  it("applies household share to balance and drops zero-share liabilities", () => {
    const rows = buildPortalLiabilityRows(
      [
        {
          id: "l1", name: "Chase Card", balance: "1000.00", liabilityType: "credit_card",
          plaidItemId: "it1", plaidAccountId: "pa1", minimumPayment: "35.00",
          statementBalance: "980.00", aprPercentage: "21.9900", nextPaymentDueDate: "2026-07-15",
        },
        {
          id: "l2", name: "Trust Note", balance: "5000.00", liabilityType: "other",
          plaidItemId: null, plaidAccountId: null, minimumPayment: null,
          statementBalance: null, aprPercentage: null, nextPaymentDueDate: null,
        },
      ],
      {
        l1: [{ kind: "family_member", familyMemberId: "fmA", entityId: null, percent: 1 }],
        l2: [{ kind: "entity", familyMemberId: null, entityId: "e1", percent: 1 }],
      },
      roles,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "l1", name: "Chase Card", balance: 1000, isPlaidLinked: true,
      aprPercentage: 21.99, statementBalance: 980, minimumPayment: 35,
      nextPaymentDueDate: "2026-07-15", liabilityType: "credit_card",
    });
  });
  it("scales a half-owned liability", () => {
    const rows = buildPortalLiabilityRows(
      [{ id: "l1", name: "Joint Auto", balance: "2000.00", liabilityType: "auto",
         plaidItemId: null, plaidAccountId: null, minimumPayment: null,
         statementBalance: null, aprPercentage: null, nextPaymentDueDate: null }],
      { l1: [{ kind: "family_member", familyMemberId: "fmA", entityId: null, percent: 0.5 }] },
      roles,
    );
    expect(rows[0].balance).toBe(1000);
  });
  it("treats an ownerless liability as fully household-owned (Plaid 'Add as new' debt)", () => {
    // Plaid debts added via the portal Manage modal carry no liability_owners
    // row; they must still appear at full balance rather than be filtered out.
    const rows = buildPortalLiabilityRows(
      [{ id: "l1", name: "Plaid Student Loan", balance: "65262.00", liabilityType: "student",
         plaidItemId: "it1", plaidAccountId: "pa1", minimumPayment: null,
         statementBalance: null, aprPercentage: null, nextPaymentDueDate: null }],
      {}, // no owner rows at all
      roles,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(65262);
    expect(rows[0].isPlaidLinked).toBe(true);
    // Ownerless → no owner ids; rawBalance == full balance.
    expect(rows[0].ownerFmIds).toEqual([]);
    expect(rows[0].ownerEntityIds).toEqual([]);
    expect(rows[0].rawBalance).toBe(65262);
  });
  it("exposes owner ids and the unscaled rawBalance for the edit form", () => {
    const rows = buildPortalLiabilityRows(
      [{ id: "l1", name: "Joint Auto", balance: "2000.00", liabilityType: "auto",
         plaidItemId: null, plaidAccountId: null, minimumPayment: null,
         statementBalance: null, aprPercentage: null, nextPaymentDueDate: null }],
      { l1: [
        { kind: "family_member", familyMemberId: "fmA", entityId: null, percent: 0.5 },
        { kind: "entity", familyMemberId: null, entityId: "e1", percent: 0.5 },
      ] },
      roles,
    );
    // Display balance is household-share-scaled (only fmA=client counts → 0.5)…
    expect(rows[0].balance).toBe(1000);
    // …but the form needs the full stored balance and the raw owner ids.
    expect(rows[0].rawBalance).toBe(2000);
    expect(rows[0].ownerFmIds).toEqual(["fmA"]);
    expect(rows[0].ownerEntityIds).toEqual(["e1"]);
  });
});
