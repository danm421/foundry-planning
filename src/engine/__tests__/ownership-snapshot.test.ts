import { describe, it, expect, vi, afterEach } from "vitest";
import { buildOwnershipSnapshot } from "../ownership-snapshot";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type {
  Account,
  EntitySummary,
  Expense,
  FamilyMember,
  GiftEvent,
  WithdrawalPriority,
} from "../types";

const acct = (id: string, owners: Account["owners"], extra: Partial<Account> = {}): Account =>
  ({ id, name: id, category: "taxable", value: 0, basis: 0, growthRate: 0,
     rmdEnabled: false, owners, ...extra } as unknown as Account);

const YEARS = [2026, 2027, 2028, 2029];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildOwnershipSnapshot", () => {
  it("returns authored owners for every year when no gift touches the account", () => {
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const snap = buildOwnershipSnapshot([a], [], YEARS, 2026);
    for (const y of YEARS) expect(snap.ownersAt(a, y)).toEqual(a.owners);
  });

  it("returns the SAME array reference for an ungifted account (no per-year clone)", () => {
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const snap = buildOwnershipSnapshot([a], [], YEARS, 2026);
    expect(snap.ownersAt(a, 2026)).toBe(a.owners);
    expect(snap.ownersAt(a, 2029)).toBe(a.owners);
  });

  it("flips ownership in the gift year and holds it afterwards", () => {
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2028, accountId: "acc-1",
      percent: 0.15, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    expect(snap.ownersAt(a, 2027)).toEqual(a.owners);
    for (const y of [2028, 2029]) {
      expect(snap.ownersAt(a, y)).toEqual([
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.85 },
        { kind: "entity", entityId: "trust-1", percent: 0.15 },
      ]);
    }
  });

  it("leaves an EMPTY owners array alone, silently, even when a gift NAMES it", () => {
    // Review Focus #1. Business children carry no account_owners rows by design
    // (the writer auto-provisions a parentAccountId-linked checking child for
    // every business). They must come back untouched — and WITHOUT the
    // canFundGifts warning, whose advice ("the caller is passing owners that
    // ALREADY have the overlay applied") is true of an ILIT policy and flatly
    // wrong for a by-design empty array. The no-warn half is what has teeth:
    // giftAwareOwners already returns [] here, so deleting the guard changes
    // nothing a value assertion can see.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const child = acct("biz-cash", [], { parentAccountId: "biz-1" });
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "biz-cash",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([child], g, YEARS, 2026);
    for (const y of YEARS) expect(snap.ownersAt(child, y)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores a gift dated before planStartYear without losing a later one", () => {
    // Review Focus #3. Historical gifts are already in the authored owners, so
    // re-applying the 2024 one would double-subtract the household to 0.6/0.4.
    //
    // The 2028 gift is what gives this teeth. An outcome that is only "the
    // authored owners, unchanged" is held by three separate filters and pins
    // none of them; pairing the historical gift with a real one means the
    // snapshot has to skip the first AND still apply the second. Dropping the
    // pre-plan filter makes the historical gift a resolution year whose result
    // is (correctly) the authored array — which the build loop then reads as
    // the canFundGifts fallback and stops on, silently discarding 2028.
    const a = acct("acc-1", [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.8 },
      { kind: "entity", entityId: "trust-1", percent: 0.2 },
    ]);
    const g: GiftEvent[] = [
      { kind: "asset", year: 2024, accountId: "acc-1",
        percent: 0.2, grantor: "client", recipientEntityId: "trust-1" },
      { kind: "asset", year: 2028, accountId: "acc-1",
        percent: 0.15, grantor: "client", recipientEntityId: "trust-2" },
    ];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    for (const y of [2026, 2027]) expect(snap.ownersAt(a, y)).toEqual(a.owners);
    for (const y of [2028, 2029]) {
      expect(snap.ownersAt(a, y)).toEqual([
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.65 },
        { kind: "entity", entityId: "trust-1", percent: 0.2 },
        { kind: "entity", entityId: "trust-2", percent: 0.15 },
      ]);
    }
  });

  it("APPLIES a gift dated exactly at planStartYear — the window is inclusive", () => {
    // Pins the `>=` end of the window that the pre-planStartYear case above
    // cannot see: with `e.year > planStartYear` a gift made in the plan's first
    // year silently vanishes for the whole horizon, and nothing else encodes it.
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2026, accountId: "acc-1",
      percent: 0.25, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    for (const y of YEARS) {
      expect(snap.ownersAt(a, y)).toEqual([
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.75 },
        { kind: "entity", entityId: "trust-1", percent: 0.25 },
      ]);
    }
  });

  it("serves an unknown account its OWN live owners, not an empty array", () => {
    // The projection creates accounts mid-loop that were never in the entry
    // list — purchase and equity destinations, and every synthetic account a
    // death event mints. Handing those back `[]` silently erases whatever they
    // do own.
    const stranger = acct("acc-new", [{ kind: "entity", entityId: "trust-9", percent: 0.4 },
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.6 }]);
    const snap = buildOwnershipSnapshot([], [], YEARS, 2026);
    expect(snap.ownersAt(stranger, 2027)).toBe(stranger.owners);
  });

  it("serves LIVE owners once the account has been rebuilt under the same id", () => {
    // partitionMixedAccount hands the family pool back under the ORIGINAL id
    // with the entity rows stripped, and an in-place bequest replaces `owners`
    // outright. Resolving those ids against the snapshot's entry rows revives
    // an entity share the projection has already moved elsewhere.
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2027, accountId: "acc-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    expect(snap.ownersAt(a, 2028)).toHaveLength(2); // the snapshot does resolve it

    const rebuilt = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-s", percent: 1 }]);
    expect(snap.ownersAt(rebuilt, 2028)).toBe(rebuilt.owners);
  });

  it("gives a year BELOW the horizon the authored baseline, never the post-gift state", () => {
    // Clamping downward would hand a pre-horizon year ownership that has not
    // happened yet from that year's point of view. The horizon deliberately
    // starts two years after planStartYear so the gift is in-window for the
    // resolver but still ahead of the year being asked about — with the gift
    // recorded at its own year instead of the first projected one, 2027 would
    // come back already retitled.
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [{ kind: "asset", year: 2026, accountId: "acc-1",
      percent: 0.2, grantor: "client", recipientEntityId: "trust-1" }];
    const snap = buildOwnershipSnapshot([a], g, [2028, 2029], 2026);
    expect(snap.ownersAt(a, 2027)).toBe(a.owners);
    expect(snap.ownersAt(a, 2028)).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.8 },
      { kind: "entity", entityId: "trust-1", percent: 0.2 },
    ]);
  });

  it("resolves a year ABOVE the horizon to the last projected year, ignoring gifts past it", () => {
    // Death-event years and hypothetical estate-tax years can sit past the
    // horizon; they must see the last projected year's ownership, not lose the
    // overlay. The 2035 gift is the part with teeth: it is outside the
    // projection, so it must never reach a read — and only the build-time
    // post-horizon filter stops it, since a read above the horizon would
    // otherwise find it as the newest step.
    const a = acct("acc-1", [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]);
    const g: GiftEvent[] = [
      { kind: "asset", year: 2027, accountId: "acc-1",
        percent: 0.2, grantor: "client", recipientEntityId: "trust-1" },
      { kind: "asset", year: 2035, accountId: "acc-1",
        percent: 0.3, grantor: "client", recipientEntityId: "trust-2" },
    ];
    const snap = buildOwnershipSnapshot([a], g, YEARS, 2026);
    const atHorizon = [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.8 },
      { kind: "entity", entityId: "trust-1", percent: 0.2 },
    ];
    expect(snap.ownersAt(a, 2029)).toEqual(atHorizon);
    expect(snap.ownersAt(a, 2099)).toEqual(atHorizon);
  });

  it("warns at most ONCE per account when the authored rows already encode the transfer", () => {
    // The ILIT / §2035 shape canFundGifts exists for: a policy modeled as
    // entity-owned with a redundant gift event. Resolving per projection year
    // instead of per gift year prints its warning once for every year of the
    // horizon — 40 lines for one account on a real plan.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const policy = acct("acc-ilit", [{ kind: "entity", entityId: "ilit-1", percent: 1 }]);
    // TWO gift years, so "warn once" is a real constraint and not an artefact
    // of there being only one year to resolve.
    const g: GiftEvent[] = [
      { kind: "asset", year: 2027, accountId: "acc-ilit",
        percent: 0.5, grantor: "client", recipientEntityId: "ilit-1" },
      { kind: "asset", year: 2028, accountId: "acc-ilit",
        percent: 0.5, grantor: "client", recipientEntityId: "ilit-1" },
    ];
    const snap = buildOwnershipSnapshot([policy], g, YEARS, 2026);
    for (const y of YEARS) expect(snap.ownersAt(policy, y)).toBe(policy.owners);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("ownership snapshot — regression: the locked-share cap after a death event", () => {
  // Fix round 1, Critical 1. `partitionMixedAccount` splits a mixed account
  // into a synthetic 100%-entity slice PLUS a family pool that keeps the
  // ORIGINAL id with the entity rows stripped. An id-keyed snapshot resolved
  // from the entry account list serves that pool its PRE-death rows, so the
  // withdraw-balance cap re-locks an entity share the trust already holds in
  // its own slice account. The trust's money is counted twice and the
  // household loses that much spendable capacity for the rest of the plan.
  //
  // The shipped death-event-locked-shares integration test runs 2026-2026, so
  // the year after the death never executes — which is why this shipped green.
  const ENT = "ent-non-iip-locked";

  const buildPlan = (planEndYear: number) => {
    const entities: EntitySummary[] = [{
      id: ENT, name: "Locked SLAT", entityType: "trust", trustSubType: "irrevocable",
      isIrrevocable: true, isGrantor: false, includeInPortfolio: false,
      accessibleToClient: false, grantor: "client",
    }];
    const familyMembers: FamilyMember[] = [
      { id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
        firstName: "Test", lastName: "Client", dateOfBirth: "1960-01-01" },
      { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
        firstName: "Test", lastName: "Spouse", dateOfBirth: "1972-06-15" },
    ];
    const checking: Account = {
      id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
      titlingType: "jtwros", value: 1000, basis: 1000, growthRate: 0,
      rmdEnabled: false, isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const mixed: Account = {
      id: "acct-mixed", name: "Joint+SLAT Brokerage", category: "taxable",
      subType: "brokerage", titlingType: "jtwros", value: 1_000_000,
      basis: 1_000_000, growthRate: 0, rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
        { kind: "entity", entityId: ENT, percent: 0.3 },
      ],
    };
    // Binding need: $400k/yr against a $1M account drains it, so the cap is
    // what decides how much of the family pool the household may actually take.
    const livingExpense: Expense = {
      id: "exp-living", name: "Living", type: "living", annualAmount: 400_000,
      growthRate: 0, startYear: 2026, endYear: planEndYear,
    };
    const strategy: WithdrawalPriority[] = [
      { accountId: "acct-mixed", priorityOrder: 1, startYear: 2026, endYear: planEndYear },
    ];
    return buildClientData({
      client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
        lifeExpectancy: 66, spouseLifeExpectancy: undefined },
      familyMembers, accounts: [checking, mixed], entities,
      incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: strategy,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear },
    });
  };

  it("lets the household spend the family pool in the year AFTER the death", () => {
    const years = runProjection(buildPlan(2029));
    const y2027 = years.find((y) => y.year === 2027)!;
    expect(y2027).toBeDefined();

    // The trust's $300k moved into its own slice account at the death.
    const slice = Object.entries(y2027.accountLedgers).find(([id]) =>
      id.startsWith("entity-slice"),
    );
    expect(slice).toBeDefined();
    expect(slice![1].endingValue).toBeCloseTo(300_000, 6);

    // The family pool kept the original id and is now 100% household-owned, so
    // the $400k need consumes all $300k of it. Reading the PRE-death rows
    // instead re-locks $300k and freezes the pool at its full balance.
    expect(y2027.accountLedgers["acct-mixed"].endingValue).toBeCloseTo(0, 6);

    // The shortfall lands in checking: $1,000 opening + $300k drawn − $400k
    // spent. The stale-owners bug leaves it $300k worse, at −$399,000.
    expect(y2027.accountLedgers["acct-checking"].endingValue).toBeCloseTo(-99_000, 6);
  });

  it("keeps the pre-death year identical to the shipped single-year fixture", () => {
    // Guards the other direction: the fix must not move the death year itself.
    const [y2026] = runProjection(buildPlan(2029));
    expect(y2026.accountLedgers["acct-mixed"].endingValue).toBeCloseTo(601_000, 6);
    expect(
      y2026.entityAccountSharesEoY?.get(ENT)?.get("acct-mixed") ?? 0,
    ).toBeCloseTo(300_000, 6);
  });
});
