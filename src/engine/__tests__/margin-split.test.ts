import { describe, it, expect } from "vitest";
import { scaleAccountValue, withLiveMargin } from "../margin";
import { splitAccount, type SplitShare } from "../death-event/shared";
import { MARGINED } from "./_fixtures/margin";
import type { Account } from "../types";

/** A kept (non-removed) will share to one family member, shaped like the
 *  existing splitAccount tests in death-event.test.ts. */
function share(fraction: number, name: string): SplitShare {
  const id = `fm-${name}`;
  return {
    fraction,
    ownerMutation: { owners: [{ kind: "family_member", familyMemberId: id, percent: 1 }] },
    ledgerMeta: { recipientKind: "family_member", recipientId: id, recipientLabel: name, via: "will" },
  };
}

describe("margin follows every split", () => {
  const live = { ...MARGINED, value: 8_000_000, basis: 9_000_000, marginBalance: 2_000_000 };
  const plain: Account = { ...live };
  delete plain.marginBalance;

  it("scaleAccountValue scales value, basis and loan together", () => {
    const s = scaleAccountValue(live, 0.25);
    expect([s.value, s.basis, s.marginBalance]).toEqual([2_000_000, 2_250_000, 500_000]);
  });

  it("scaleAccountValue leaves a loan-less account without the field", () => {
    expect("marginBalance" in scaleAccountValue(plain, 0.5)).toBe(false);
  });

  it("withLiveMargin swaps in the live loan from the map", () => {
    expect(withLiveMargin(MARGINED, { "acct-margin": 2_300_000 }).marginBalance).toBe(2_300_000);
  });

  it("withLiveMargin: a live map without the account means the loan was paid off — $0, never the plan-start loan", () => {
    expect(withLiveMargin(MARGINED, {}).marginBalance).toBe(0);
    // A share a death left on the object is cleared with it, never resurrected.
    const stale = { ...MARGINED, marginPersonalShare: 0.4 };
    expect(withLiveMargin(stale, {}, {})).toMatchObject({ marginBalance: 0, marginPersonalShare: 0 });
  });

  it("withLiveMargin: no map at all (a fixture) keeps the account's own loan", () => {
    expect(withLiveMargin(MARGINED, undefined)).toBe(MARGINED);
  });

  it("withLiveMargin: an account with no loan comes back unchanged", () => {
    expect(withLiveMargin(plain, {}, {})).toBe(plain);
  });

  it("splitAccount 60/40 splits the loan 60/40", () => {
    const { resultingAccounts } = splitAccount(live, [share(0.6, "Kid A"), share(0.4, "Kid B")], undefined);
    expect(resultingAccounts.map((a) => a.marginBalance)).toEqual([1_200_000, 800_000]);
  });

  it("splitAccount leaves a loan-less account's shares without the field", () => {
    const { resultingAccounts } = splitAccount(plain, [share(0.6, "Kid A"), share(0.4, "Kid B")], undefined);
    expect(resultingAccounts.map((a) => "marginBalance" in a)).toEqual([false, false]);
  });
});
