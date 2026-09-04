// src/lib/ops/growth/__tests__/metrics.test.ts
import { describe, it, expect } from "vitest";
import { buildMetrics } from "../metrics";
import { ANNUAL_PERIOD_THRESHOLD_DAYS, type GrowthInput } from "../types";

const NOW = new Date("2026-09-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const EMPTY: GrowthInput = {
  firms: [], subs: [], items: [], activity: [], users: [],
  clientCountByFirm: {}, now: NOW,
};

const firm = (over: Partial<GrowthInput["firms"][number]> = {}) => ({
  firmId: "org_1", displayName: "Acme", isFounder: false,
  archivedAt: null, createdAt: day(-100), ...over,
});

const sub = (over: Partial<GrowthInput["subs"][number]> = {}) => ({
  firmId: "org_1", status: "active",
  trialStart: null, trialEnd: null, canceledAt: null,
  cancelAtPeriodEnd: false,
  currentPeriodStart: day(-10), currentPeriodEnd: day(20),
  ...over,
});

describe("buildMetrics — MRR", () => {
  it("sums a monthly seat line at face value", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub()],
      items: [{ firmId: "org_1", quantity: 3, unitAmount: 9900, removedAt: null }],
    });
    expect(m.mrrCents).toBe(29_700);
  });

  it("divides an annual seat line by twelve", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ currentPeriodStart: day(-10), currentPeriodEnd: day(355) })],
      items: [{ firmId: "org_1", quantity: 1, unitAmount: 120_000, removedAt: null }],
    });
    expect(m.mrrCents).toBe(10_000);
  });

  it("normalises a period exactly at the annual threshold", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [
        sub({
          currentPeriodStart: day(-10),
          currentPeriodEnd: day(-10 + ANNUAL_PERIOD_THRESHOLD_DAYS),
        }),
      ],
      items: [{ firmId: "org_1", quantity: 1, unitAmount: 120_000, removedAt: null }],
    });
    expect(m.mrrCents).toBe(10_000);
  });

  it("does not normalise a period one day short of the annual threshold", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [
        sub({
          currentPeriodStart: day(-10),
          currentPeriodEnd: day(-10 + ANNUAL_PERIOD_THRESHOLD_DAYS - 1),
        }),
      ],
      items: [{ firmId: "org_1", quantity: 1, unitAmount: 120_000, removedAt: null }],
    });
    expect(m.mrrCents).toBe(120_000);
  });

  it("ignores a removed line", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub()],
      items: [{ firmId: "org_1", quantity: 1, unitAmount: 9900, removedAt: day(-1) }],
    });
    expect(m.mrrCents).toBe(0);
  });

  it("counts nothing for a trialing subscription", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ status: "trialing", trialStart: day(-3), trialEnd: day(11) })],
      items: [{ firmId: "org_1", quantity: 1, unitAmount: 9900, removedAt: null }],
    });
    expect(m.mrrCents).toBe(0);
  });

  it("excludes a founder firm from revenue", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm({ isFounder: true })],
      subs: [sub()],
      items: [{ firmId: "org_1", quantity: 5, unitAmount: 9900, removedAt: null }],
    });
    expect(m.mrrCents).toBe(0);
  });
});

describe("buildMetrics — trials and conversion", () => {
  it("counts a running trial and flags one ending inside the horizon", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm(), firm({ firmId: "org_2" })],
      subs: [
        sub({ status: "trialing", trialEnd: day(2) }),
        sub({ firmId: "org_2", status: "trialing", trialEnd: day(12) }),
      ],
    });
    expect(m.trialsRunning).toBe(2);
    expect(m.trialsEndingSoon).toBe(1);
  });

  it("treats a cancellation after the trial ended as a conversion", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ status: "canceled", trialEnd: day(-40), canceledAt: day(-5) })],
    });
    expect(m.resolvedTrials).toBe(1);
    expect(m.convertedTrials).toBe(1);
    expect(m.trialToPaidPct).toBe(100);
  });

  it("treats a cancellation during the trial as a failure to convert", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ status: "canceled", trialEnd: day(-40), canceledAt: day(-45) })],
    });
    expect(m.resolvedTrials).toBe(1);
    expect(m.convertedTrials).toBe(0);
    expect(m.trialToPaidPct).toBe(0);
  });

  it("does not count a still-running trial as resolved", () => {
    const m = buildMetrics({
      ...EMPTY,
      firms: [firm()],
      subs: [sub({ status: "trialing", trialEnd: day(5) })],
    });
    expect(m.resolvedTrials).toBe(0);
    expect(m.trialToPaidPct).toBeNull();
  });

  it("returns null conversion rather than 0% when nothing has resolved", () => {
    expect(buildMetrics(EMPTY).trialToPaidPct).toBeNull();
  });
});

describe("buildMetrics — activity and stalls", () => {
  it("counts distinct actors inside the window", () => {
    const m = buildMetrics({
      ...EMPTY,
      activity: [
        { firmId: "org_1", actorId: "user_a", action: "client.create", createdAt: day(-1) },
        { firmId: "org_1", actorId: "user_a", action: "income.update", createdAt: day(-2) },
        { firmId: "org_1", actorId: "user_b", action: "client.create", createdAt: day(-3) },
      ],
    });
    expect(m.activeThisWeek).toBe(2);
  });

  it("does not count a blocked paywall attempt as work", () => {
    const m = buildMetrics({
      ...EMPTY,
      activity: [
        { firmId: "org_1", actorId: "user_a", action: "billing.access_denied", createdAt: day(-1) },
      ],
    });
    expect(m.activeThisWeek).toBe(0);
  });

  it("ignores activity older than the window", () => {
    const m = buildMetrics({
      ...EMPTY,
      activity: [
        { firmId: "org_1", actorId: "user_a", action: "client.create", createdAt: day(-8) },
      ],
    });
    expect(m.activeThisWeek).toBe(0);
  });

  it("counts a user holding a stash and no org as stalled", () => {
    const m = buildMetrics({
      ...EMPTY,
      users: [
        { userId: "user_a", email: "a@x.com", firstName: null, lastName: null,
          createdAt: day(-2), lastSignInAt: day(-2),
          hasPendingSignup: true, pendingFirmName: "Acme", firmIds: [] },
        { userId: "user_b", email: "b@x.com", firstName: null, lastName: null,
          createdAt: day(-2), lastSignInAt: day(-2),
          hasPendingSignup: true, pendingFirmName: "Beta", firmIds: ["org_1"] },
      ],
    });
    expect(m.stalledAtCheckout).toBe(1);
  });
});
