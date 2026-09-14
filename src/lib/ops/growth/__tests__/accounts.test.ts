import { describe, it, expect } from "vitest";
import { buildAccountRows } from "../accounts";
import { CANCELED_WITHIN_DAYS, TRIAL_ENDING_DAYS } from "../attention";
import type { GrowthInput } from "../types";

const NOW = new Date("2026-09-14T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const EMPTY: GrowthInput = {
  firms: [], subs: [], items: [], activity: [], users: [],
  clientCountByFirm: {}, clientCountByAdvisor: {}, now: NOW,
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

const user = (over: Partial<GrowthInput["users"][number]> = {}) => ({
  userId: "user_1", email: "ada@x.com", firstName: "Ada", lastName: "Byron",
  createdAt: day(-30), lastSignInAt: day(-1), hasPendingSignup: false,
  pendingFirmName: null, firmIds: ["org_1"], ...over,
});

describe("buildAccountRows — who is on the table", () => {
  it("includes a trial that is nowhere near ending", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ trialEnd: day(TRIAL_ENDING_DAYS + 7) })],
    };
    expect(buildAccountRows(i).map((r) => r.firm)).toEqual(["Acme"]);
  });

  it("includes a recent cancellation that is no longer trialing", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ status: "canceled", canceledAt: day(-2) })],
    };
    const [row] = buildAccountRows(i);
    expect(row.canceled).toBe("Canceled");
    expect(row.trialDaysLeft).toBeNull();
  });

  it("drops a cancellation older than the window", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ status: "canceled", canceledAt: day(-(CANCELED_WITHIN_DAYS + 1)) })],
    };
    expect(buildAccountRows(i)).toEqual([]);
  });

  it("leaves out an active paying firm — nothing is in play", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ status: "active", trialEnd: null })] };
    expect(buildAccountRows(i)).toEqual([]);
  });

  it("ignores a founder firm", () => {
    const i = { ...EMPTY, firms: [firm({ isFounder: true })], subs: [sub()] };
    expect(buildAccountRows(i)).toEqual([]);
  });

  it("emits ONE row for a firm that is both trialing and canceled", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ canceledAt: day(-1) })] };
    const rows = buildAccountRows(i);
    expect(rows).toHaveLength(1);
    expect(rows[0].trialDaysLeft).toBe(2);
    expect(rows[0].canceled).toBe("Canceled");
  });

  it("distinguishes a period-end cancellation from an immediate one", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ canceledAt: day(-1), cancelAtPeriodEnd: true })],
    };
    expect(buildAccountRows(i)[0].canceled).toBe("Canceling at period end");
  });
});

describe("buildAccountRows — the contact", () => {
  it("carries the member's name and email", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub()], users: [user()] };
    const [row] = buildAccountRows(i);
    expect(row.contactName).toBe("Ada Byron");
    expect(row.contactEmail).toBe("ada@x.com");
    expect(row.otherMembers).toBe(0);
  });

  it("picks the earliest-joined member and counts the rest", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub()],
      users: [
        user({ userId: "user_2", firstName: "Grace", lastName: "Hopper", email: "g@x.com", createdAt: day(-5) }),
        user({ createdAt: day(-30) }),
      ],
    };
    const [row] = buildAccountRows(i);
    expect(row.contactName).toBe("Ada Byron");
    expect(row.otherMembers).toBe(1);
  });

  it("ignores members of a different firm", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub()],
      users: [user({ firmIds: ["org_other"] })],
    };
    const [row] = buildAccountRows(i);
    expect(row.contactName).toBeNull();
    expect(row.contactEmail).toBeNull();
  });

  it("falls back to the email when Clerk has no name", () => {
    const i = {
      ...EMPTY,
      firms: [firm()],
      subs: [sub()],
      users: [user({ firstName: null, lastName: null })],
    };
    expect(buildAccountRows(i)[0].contactName).toBeNull();
    expect(buildAccountRows(i)[0].contactEmail).toBe("ada@x.com");
  });
});

describe("buildAccountRows — days left", () => {
  it("floors a part-day so a trial ending tonight reads as 0, not 1", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(0.4) })] };
    expect(buildAccountRows(i)[0].trialDaysLeft).toBe(0);
  });

  it("goes negative when Stripe has not flipped the status yet", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: day(-2) })] };
    expect(buildAccountRows(i)[0].trialDaysLeft).toBe(-2);
  });

  it("is null when a trialing sub carries no trial end", () => {
    const i = { ...EMPTY, firms: [firm()], subs: [sub({ trialEnd: null, canceledAt: day(-1) })] };
    expect(buildAccountRows(i)[0].trialDaysLeft).toBeNull();
  });
});

describe("buildAccountRows — order", () => {
  it("puts the soonest-expiring trial first and pure cancellations last", () => {
    const i = {
      ...EMPTY,
      firms: [
        firm(),
        firm({ firmId: "org_2", displayName: "Beta" }),
        firm({ firmId: "org_3", displayName: "Gamma" }),
      ],
      subs: [
        sub({ trialEnd: day(10) }),
        sub({ firmId: "org_2", trialEnd: day(1) }),
        sub({ firmId: "org_3", status: "canceled", trialEnd: null, canceledAt: day(-3) }),
      ],
    };
    expect(buildAccountRows(i).map((r) => r.firm)).toEqual(["Beta", "Acme", "Gamma"]);
  });
});
