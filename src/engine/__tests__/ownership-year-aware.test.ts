import { describe, it, expect } from "vitest";
import {
  ownersForYear,
  ownedByEntityAtYear,
  ownedByHouseholdAtYear,
  type AccountWithOwners,
} from "@/engine/ownership";
import type { GiftEvent } from "@/engine/types";

const PROJ_START = 2026;

function acct(owners: { kind: "family_member" | "entity"; id: string; percent: number }[]): AccountWithOwners {
  return {
    id: "a1",
    owners: owners.map((o) =>
      o.kind === "family_member"
        ? { kind: "family_member", familyMemberId: o.id, percent: o.percent }
        : { kind: "entity", entityId: o.id, percent: o.percent },
    ),
  } as AccountWithOwners;
}

describe("ownersForYear", () => {
  it("returns static owners when no gift events apply", () => {
    const a = acct([{ kind: "family_member", id: "fm-client", percent: 1 }]);
    expect(ownersForYear(a, [], 2030, PROJ_START)).toEqual(a.owners);
  });

  it("ignores gift events with year < projectionStartYear (historical)", () => {
    const a = acct([{ kind: "entity", id: "trust-1", percent: 0.5 }, { kind: "family_member", id: "fm-client", percent: 0.5 }]);
    const events: GiftEvent[] = [
      { kind: "asset", year: 2024, accountId: "a1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" },
    ];
    expect(ownersForYear(a, events, 2030, PROJ_START)).toEqual(a.owners);
  });

  it("applies a future-dated 50% transfer at the gift year", () => {
    const a = acct([{ kind: "family_member", id: "fm-client", percent: 1 }]);
    const events: GiftEvent[] = [
      { kind: "asset", year: 2030, accountId: "a1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" },
    ];
    expect(ownersForYear(a, events, 2029, PROJ_START)).toEqual(a.owners);
    const post = ownersForYear(a, events, 2030, PROJ_START);
    expect(post).toHaveLength(2);
    expect(post.find((o) => o.kind === "entity" && o.entityId === "trust-1")?.percent).toBeCloseTo(0.5);
    expect(post.find((o) => o.kind === "family_member" && o.familyMemberId === "fm-client")?.percent).toBeCloseTo(0.5);
  });

  it("composes multiple sequential transfers", () => {
    const a = acct([
      { kind: "family_member", id: "fm-client", percent: 0.5 },
      { kind: "family_member", id: "fm-spouse", percent: 0.5 },
    ]);
    const events: GiftEvent[] = [
      { kind: "asset", year: 2030, accountId: "a1", percent: 0.4, grantor: "client", recipientEntityId: "trust-1" },
      { kind: "asset", year: 2032, accountId: "a1", percent: 0.2, grantor: "spouse", recipientEntityId: "trust-1" },
    ];
    const post = ownersForYear(a, events, 2032, PROJ_START);
    expect(post.find((o) => o.kind === "entity" && o.entityId === "trust-1")?.percent).toBeCloseTo(0.6);
    const totalHousehold = post
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);
    expect(totalHousehold).toBeCloseTo(0.4);
  });

  it("throws when a transfer would overdraw available household percent", () => {
    const a = acct([{ kind: "family_member", id: "fm-client", percent: 0.3 }, { kind: "entity", id: "trust-other", percent: 0.7 }]);
    const events: GiftEvent[] = [
      { kind: "asset", year: 2030, accountId: "a1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" },
    ];
    expect(() => ownersForYear(a, events, 2030, PROJ_START)).toThrow(/overdraw|exceed/i);
  });

  it("throws on a second transfer once the household has been fully drained", () => {
    const a = acct([{ kind: "family_member", id: "fm-client", percent: 1 }]);
    const events: GiftEvent[] = [
      { kind: "asset", year: 2030, accountId: "a1", percent: 1, grantor: "client", recipientEntityId: "trust-1" },
      { kind: "asset", year: 2032, accountId: "a1", percent: 0.0001, grantor: "client", recipientEntityId: "trust-2" },
    ];
    expect(() => ownersForYear(a, events, 2032, PROJ_START)).toThrow(/no household share remaining/i);
  });

  it("validates sum-to-1 invariant after composition", () => {
    const a = acct([{ kind: "family_member", id: "fm-client", percent: 0.5 }, { kind: "family_member", id: "fm-spouse", percent: 0.5 }]);
    const events: GiftEvent[] = [
      { kind: "asset", year: 2030, accountId: "a1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" },
    ];
    const post = ownersForYear(a, events, 2030, PROJ_START);
    const total = post.reduce((s, o) => s + o.percent, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("ownedByEntityAtYear / ownedByHouseholdAtYear", () => {
  const a = (acct([{ kind: "family_member", id: "fm-client", percent: 1 }]));
  const events: GiftEvent[] = [
    { kind: "asset", year: 2030, accountId: "a1", percent: 0.5, grantor: "client", recipientEntityId: "trust-1" },
  ];

  it("returns 0 entity, 1 household pre-transfer", () => {
    expect(ownedByEntityAtYear(a, events, "trust-1", 2029, PROJ_START)).toBe(0);
    expect(ownedByHouseholdAtYear(a, events, 2029, PROJ_START)).toBe(1);
  });

  it("returns 0.5 / 0.5 post-transfer", () => {
    expect(ownedByEntityAtYear(a, events, "trust-1", 2031, PROJ_START)).toBeCloseTo(0.5);
    expect(ownedByHouseholdAtYear(a, events, 2031, PROJ_START)).toBeCloseTo(0.5);
  });
});
