import { describe, it, expect } from "vitest";
import {
  ownersForYearOrHousehold,
  ownersForYearSafe,
  HOUSEHOLD_OWNER_FALLBACK,
} from "../owners-or-household";
import type { Account, GiftEvent } from "@/engine/types";

const account = (owners: unknown[]): Account =>
  ({ id: "acc-1", name: "Cash", category: "cash", value: 50_000, owners }) as unknown as Account;

const CLIENT = [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }];

describe("ownersForYearSafe", () => {
  it("composes gift events like ownersForYearOrHousehold on well-formed input", () => {
    const gifts: GiftEvent[] = [
      {
        kind: "asset",
        accountId: "acc-1",
        percent: 0.3,
        year: 2027,
        grantor: "client",
        recipientFamilyMemberId: "fm-kid",
      } as unknown as GiftEvent,
    ];
    expect(ownersForYearSafe(account(CLIENT), gifts, 2027, 2026)).toEqual(
      ownersForYearOrHousehold(account(CLIENT), gifts, 2027, 2026),
    );
  });

  it("keeps a household owner for a pooled account with no owner rows", () => {
    // Default-checking cash carries no `account_owners`. It must resolve to the
    // household sentinel, never to [] — an empty owner list drops the account
    // from every ownership-driven report.
    const gifts: GiftEvent[] = [
      {
        kind: "asset",
        accountId: "acc-1",
        percent: 0.3,
        year: 2027,
        grantor: "client",
        recipientFamilyMemberId: "fm-kid",
      } as unknown as GiftEvent,
    ];
    expect(ownersForYearSafe(account([]), gifts, 2027, 2026)).toEqual(
      HOUSEHOLD_OWNER_FALLBACK,
    );
  });

  it("falls back to the authored owners when a gift event overdraws the household", () => {
    // 150% of the account gifted away — `ownersForYear` throws. The column
    // should still render the authored split rather than blowing up.
    const gifts: GiftEvent[] = [
      {
        kind: "asset",
        accountId: "acc-1",
        percent: 1.5,
        year: 2027,
        grantor: "client",
        recipientFamilyMemberId: "fm-kid",
      } as unknown as GiftEvent,
    ];
    expect(() => ownersForYearOrHousehold(account(CLIENT), gifts, 2027, 2026)).toThrow();
    expect(ownersForYearSafe(account(CLIENT), gifts, 2027, 2026)).toEqual(CLIENT);
  });
});
