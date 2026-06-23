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
});
