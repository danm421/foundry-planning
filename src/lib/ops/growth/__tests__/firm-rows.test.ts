import { describe, it, expect } from "vitest";
import { buildFirmRows } from "../firm-rows";
import type { GrowthInput } from "../types";

const NOW = new Date("2026-09-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const EMPTY: GrowthInput = {
  firms: [], subs: [], items: [], activity: [], users: [],
  clientCountByFirm: {}, now: NOW,
};

const firm = (over: Partial<GrowthInput["firms"][number]> = {}) => ({
  firmId: "org_1", displayName: "Acme", isFounder: false,
  archivedAt: null, createdAt: day(-30), ...over,
});

describe("buildFirmRows", () => {
  it("fills every column from its own source", () => {
    // Deliberately distinct values: seats 7, clients 3, and two different
    // dates, so swapping any two fields fails.
    const rows = buildFirmRows({
      ...EMPTY,
      firms: [firm()],
      subs: [{
        firmId: "org_1", status: "trialing",
        trialStart: day(-3), trialEnd: day(11), canceledAt: null,
        cancelAtPeriodEnd: false, currentPeriodStart: day(-3), currentPeriodEnd: day(11),
      }],
      items: [
        { firmId: "org_1", quantity: 4, unitAmount: 9900, removedAt: null },
        { firmId: "org_1", quantity: 3, unitAmount: 9900, removedAt: null },
      ],
      activity: [
        { firmId: "org_1", actorId: "user_a", action: "client.create", createdAt: day(-2) },
        { firmId: "org_1", actorId: "user_a", action: "income.update", createdAt: day(-5) },
      ],
      users: [{
        userId: "user_a", email: "a@x.com", firstName: "Ada", lastName: null,
        createdAt: day(-30), lastSignInAt: day(-1),
        hasPendingSignup: false, pendingFirmName: null, firmIds: ["org_1"],
      }],
      clientCountByFirm: { org_1: 3 },
    });

    expect(rows).toEqual([{
      firmId: "org_1",
      displayName: "Acme",
      isFounder: false,
      status: "trialing",
      seats: 7,
      lastSignInAt: day(-1).toISOString(),
      lastActionAt: day(-2).toISOString(),
      clients: 3,
    }]);
  });

  it("labels a founder firm 'founder' regardless of its subscription", () => {
    const rows = buildFirmRows({
      ...EMPTY,
      firms: [firm({ isFounder: true })],
      subs: [{
        firmId: "org_1", status: "active",
        trialStart: null, trialEnd: null, canceledAt: null,
        cancelAtPeriodEnd: false, currentPeriodStart: day(-10), currentPeriodEnd: day(20),
      }],
    });
    expect(rows[0]!.status).toBe("founder");
    expect(rows[0]!.isFounder).toBe(true);
  });

  it("reports 'none' when a non-founder firm has no subscription", () => {
    expect(buildFirmRows({ ...EMPTY, firms: [firm()] })[0]!.status).toBe("none");
  });

  it("takes the most recent sign-in across several members", () => {
    const member = (id: string, at: Date) => ({
      userId: id, email: null, firstName: null, lastName: null,
      createdAt: day(-30), lastSignInAt: at,
      hasPendingSignup: false, pendingFirmName: null, firmIds: ["org_1"],
    });
    const rows = buildFirmRows({
      ...EMPTY, firms: [firm()],
      users: [member("user_a", day(-9)), member("user_b", day(-2))],
    });
    expect(rows[0]!.lastSignInAt).toBe(day(-2).toISOString());
  });

  it("shows a never-signed-in, never-acted firm as nulls, not zeroes", () => {
    const row = buildFirmRows({ ...EMPTY, firms: [firm()] })[0]!;
    expect(row.lastSignInAt).toBeNull();
    expect(row.lastActionAt).toBeNull();
    expect(row.clients).toBe(0);
    expect(row.seats).toBe(0);
  });

  it("does not let one firm's activity leak into another's row", () => {
    const rows = buildFirmRows({
      ...EMPTY,
      firms: [firm(), firm({ firmId: "org_2", displayName: "Beta" })],
      activity: [
        { firmId: "org_2", actorId: "user_b", action: "client.create", createdAt: day(-1) },
      ],
      clientCountByFirm: { org_2: 5 },
    });
    const acme = rows.find((r) => r.firmId === "org_1")!;
    expect(acme.lastActionAt).toBeNull();
    expect(acme.clients).toBe(0);
  });

  it("falls back to a placeholder when the firm has no display name", () => {
    expect(buildFirmRows({ ...EMPTY, firms: [firm({ displayName: null })] })[0]!.displayName)
      .toBe("(unnamed)");
  });
});
