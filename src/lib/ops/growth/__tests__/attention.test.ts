import { describe, it, expect } from "vitest";
import {
  buildAttention,
  TRIAL_ENDING_DAYS,
  QUIET_DAYS,
  PAYWALL_HIT_THRESHOLD,
} from "../attention";
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

const sub = (over: Partial<GrowthInput["subs"][number]> = {}) => ({
  firmId: "org_1", status: "trialing",
  trialStart: day(-3), trialEnd: day(2), canceledAt: null,
  cancelAtPeriodEnd: false, currentPeriodStart: day(-3), currentPeriodEnd: day(2),
  ...over,
});

const kinds = (i: GrowthInput) => buildAttention(i).map((r) => r.kind);

describe("buildAttention — trial ending", () => {
  it("fires exactly at the threshold", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(TRIAL_ENDING_DAYS) })] };
    expect(kinds(i)).toContain("trial_ending");
  });

  it("stays silent one day outside the threshold", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(TRIAL_ENDING_DAYS + 1) })] };
    expect(kinds(i)).not.toContain("trial_ending");
  });

  it("says how many days are left", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(2) })] };
    const row = buildAttention(i).find((r) => r.kind === "trial_ending")!;
    expect(row.headline).toBe("Trial ends in 2 days");
    expect(row.who).toBe("Acme");
  });

  it("ignores a founder firm", () => {
    const i = { ...EMPTY, firms: [firm({ isFounder: true })], subs: [sub()] };
    expect(kinds(i)).not.toContain("trial_ending");
  });
});

describe("buildAttention — cancellations", () => {
  it("reports a recent cancellation", () => {
    const i = {
      ...EMPTY, firms: [firm()],
      subs: [sub({ status: "canceled", canceledAt: day(-3), trialEnd: day(-40) })],
    };
    expect(kinds(i)).toContain("canceled");
  });

  it("drops a cancellation older than the window", () => {
    const i = {
      ...EMPTY, firms: [firm()],
      subs: [sub({ status: "canceled", canceledAt: day(-45), trialEnd: day(-90) })],
    };
    expect(kinds(i)).not.toContain("canceled");
  });
});

describe("buildAttention — quiet and blocked", () => {
  it("flags a trialing firm that signed in but logged no action", () => {
    const i: GrowthInput = {
      ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(9) })],
      users: [{
        userId: "user_a", email: "a@x.com", firstName: "Ada", lastName: null,
        createdAt: day(-10), lastSignInAt: day(-1),
        hasPendingSignup: false, pendingFirmName: null, firmIds: ["org_1"],
      }],
      activity: [{
        firmId: "org_1", actorId: "user_a", action: "client.create",
        createdAt: day(-(QUIET_DAYS + 1)),
      }],
    };
    expect(kinds(i)).toContain("signed_in_not_working");
  });

  it("does not flag a trialing firm that is working", () => {
    const i: GrowthInput = {
      ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(9) })],
      users: [{
        userId: "user_a", email: "a@x.com", firstName: "Ada", lastName: null,
        createdAt: day(-10), lastSignInAt: day(-1),
        hasPendingSignup: false, pendingFirmName: null, firmIds: ["org_1"],
      }],
      activity: [{ firmId: "org_1", actorId: "user_a", action: "client.create", createdAt: day(-1) }],
    };
    expect(kinds(i)).not.toContain("signed_in_not_working");
  });

  it("flags repeated paywall hits at the threshold", () => {
    const activity = Array.from({ length: PAYWALL_HIT_THRESHOLD }, () => ({
      firmId: "org_1", actorId: "user_a",
      action: "billing.access_denied", createdAt: day(-1),
    }));
    expect(kinds({ ...EMPTY, firms: [firm()], activity })).toContain("paywall_blocked");
  });

  it("stays silent one hit below the threshold", () => {
    const activity = Array.from({ length: PAYWALL_HIT_THRESHOLD - 1 }, () => ({
      firmId: "org_1", actorId: "user_a",
      action: "billing.access_denied", createdAt: day(-1),
    }));
    expect(kinds({ ...EMPTY, firms: [firm()], activity })).not.toContain("paywall_blocked");
  });
});

describe("buildAttention — signups", () => {
  it("reports a brand new account and a fresh stall separately", () => {
    const i: GrowthInput = {
      ...EMPTY,
      users: [
        { userId: "user_a", email: "a@x.com", firstName: null, lastName: null,
          createdAt: day(-0.5), lastSignInAt: day(-0.5),
          hasPendingSignup: false, pendingFirmName: null, firmIds: [] },
        { userId: "user_b", email: "b@x.com", firstName: null, lastName: null,
          createdAt: day(-0.5), lastSignInAt: day(-0.5),
          hasPendingSignup: true, pendingFirmName: "Beta", firmIds: [] },
      ],
    };
    const k = kinds(i);
    expect(k).toContain("new_signup");
    expect(k).toContain("stalled_checkout");
  });

  it("produces one row per distinct concern, not one merged row", () => {
    const i: GrowthInput = {
      ...EMPTY, firms: [firm()],
      subs: [sub({ trialEnd: day(1) })],
      activity: Array.from({ length: PAYWALL_HIT_THRESHOLD }, () => ({
        firmId: "org_1", actorId: "user_a",
        action: "billing.access_denied", createdAt: day(-1),
      })),
    };
    const k = kinds(i);
    expect(k).toContain("trial_ending");
    expect(k).toContain("paywall_blocked");
    expect(k.length).toBe(2);
  });
});
