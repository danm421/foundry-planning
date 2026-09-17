import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

import { getSubscriptionState, stateFromMeta } from "../subscription-state";

beforeEach(() => mockAuth.mockReset());

function withMeta(meta: Record<string, unknown>) {
  mockAuth.mockResolvedValue({
    sessionClaims: { org_public_metadata: meta },
  });
}

describe("getSubscriptionState", () => {
  it("returns founder for is_founder=true", async () => {
    withMeta({ is_founder: true, subscription_status: "founder" });
    expect(await getSubscriptionState()).toEqual({ kind: "founder" });
  });

  it("returns trialing with trialEndsAt", async () => {
    const trialEnd = "2026-05-15T00:00:00Z";
    withMeta({ subscription_status: "trialing", trial_ends_at: trialEnd });
    expect(await getSubscriptionState()).toEqual({
      kind: "trialing",
      trialEndsAt: new Date(trialEnd),
    });
  });

  it("returns active for subscription_status=active without cancel flag", async () => {
    withMeta({ subscription_status: "active" });
    expect(await getSubscriptionState()).toEqual({ kind: "active" });
  });

  it("returns active_canceling when active + cancel_at_period_end", async () => {
    const periodEnd = "2026-06-01T00:00:00Z";
    withMeta({
      subscription_status: "active",
      cancel_at_period_end: true,
      current_period_end: periodEnd,
    });
    expect(await getSubscriptionState()).toEqual({
      kind: "active_canceling",
      periodEnd: new Date(periodEnd),
    });
  });

  it("returns past_due for subscription_status=past_due", async () => {
    withMeta({ subscription_status: "past_due" });
    expect(await getSubscriptionState()).toEqual({ kind: "past_due", pastDueSince: null });
  });

  it("returns canceled_grace within 30 days of archived_at", async () => {
    const archivedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    withMeta({
      subscription_status: "canceled",
      archived_at: archivedAt,
    });
    const state = await getSubscriptionState();
    expect(state.kind).toBe("canceled_grace");
    if (state.kind === "canceled_grace") {
      expect(state.archivedAt.toISOString()).toBe(archivedAt);
      expect(state.mutationsAllowed).toBe(false);
    }
  });

  it("returns canceled_locked past the 30-day grace window", async () => {
    const archivedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    withMeta({
      subscription_status: "canceled",
      archived_at: archivedAt,
    });
    expect(await getSubscriptionState()).toEqual({ kind: "canceled_locked" });
  });

  it("returns canceled_locked when subscription_status=canceled but no archived_at (pessimistic)", async () => {
    withMeta({ subscription_status: "canceled" });
    expect(await getSubscriptionState()).toEqual({ kind: "canceled_locked" });
  });

  it("returns missing when org_public_metadata is empty", async () => {
    withMeta({});
    expect(await getSubscriptionState()).toEqual({
      kind: "missing",
      reason: "no_metadata",
    });
  });

  it("returns missing when sessionClaims has no org_public_metadata", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: {} });
    expect(await getSubscriptionState()).toEqual({
      kind: "missing",
      reason: "no_metadata",
    });
  });

  it("returns canceled_locked at exactly 30 days (half-open boundary)", async () => {
    const archivedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    withMeta({ subscription_status: "canceled", archived_at: archivedAt });
    expect(await getSubscriptionState()).toEqual({ kind: "canceled_locked" });
  });

  it("returns canceled_locked when archived_at is in the future (defensive)", async () => {
    const archivedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    withMeta({ subscription_status: "canceled", archived_at: archivedAt });
    expect(await getSubscriptionState()).toEqual({ kind: "canceled_locked" });
  });

  it("falls through to active when active+cancel_at_period_end has malformed current_period_end", async () => {
    withMeta({
      subscription_status: "active",
      cancel_at_period_end: true,
      current_period_end: "garbage",
    });
    expect(await getSubscriptionState()).toEqual({ kind: "active" });
  });

  it("falls through to missing when trialing has malformed trial_ends_at", async () => {
    withMeta({ subscription_status: "trialing", trial_ends_at: "garbage" });
    expect(await getSubscriptionState()).toEqual({ kind: "missing", reason: "no_metadata" });
  });

  it("returns canceled_locked when canceled has malformed archived_at", async () => {
    withMeta({ subscription_status: "canceled", archived_at: "garbage" });
    expect(await getSubscriptionState()).toEqual({ kind: "canceled_locked" });
  });

  it("returns unpaid for subscription_status=unpaid (terminal)", async () => {
    withMeta({ subscription_status: "unpaid" });
    expect(await getSubscriptionState()).toEqual({ kind: "unpaid" });
  });

  it("returns paused for subscription_status=paused (terminal)", async () => {
    withMeta({ subscription_status: "paused" });
    expect(await getSubscriptionState()).toEqual({ kind: "paused" });
  });

  it("treats incomplete_expired like canceled with no archived_at (locked)", async () => {
    withMeta({ subscription_status: "incomplete_expired" });
    expect(await getSubscriptionState()).toEqual({ kind: "canceled_locked" });
  });

  it("treats incomplete_expired within 30d of archived_at as grace", async () => {
    const archivedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    withMeta({ subscription_status: "incomplete_expired", archived_at: archivedAt });
    const state = await getSubscriptionState();
    expect(state.kind).toBe("canceled_grace");
  });

  it("returns past_due with pastDueSince parsed from current_period_end", async () => {
    const periodEnd = "2026-06-01T00:00:00Z";
    withMeta({ subscription_status: "past_due", current_period_end: periodEnd });
    expect(await getSubscriptionState()).toEqual({
      kind: "past_due",
      pastDueSince: new Date(periodEnd),
    });
  });

  it("returns past_due with null pastDueSince when no current_period_end", async () => {
    withMeta({ subscription_status: "past_due" });
    expect(await getSubscriptionState()).toEqual({
      kind: "past_due",
      pastDueSince: null,
    });
  });
});

describe("stateFromMeta (pure)", () => {
  it("returns missing for empty meta", () => {
    expect(stateFromMeta({})).toEqual({ kind: "missing", reason: "no_metadata" });
    expect(stateFromMeta(undefined)).toEqual({ kind: "missing", reason: "no_metadata" });
  });

  it("returns founder for is_founder=true regardless of status", () => {
    expect(stateFromMeta({ is_founder: true, subscription_status: "canceled" })).toEqual({
      kind: "founder",
    });
  });

  it("maps unpaid and paused to their terminal kinds", () => {
    expect(stateFromMeta({ subscription_status: "unpaid" })).toEqual({ kind: "unpaid" });
    expect(stateFromMeta({ subscription_status: "paused" })).toEqual({ kind: "paused" });
  });

  it("maps active+cancel_at_period_end to active_canceling", () => {
    const periodEnd = "2026-06-01T00:00:00Z";
    expect(
      stateFromMeta({
        subscription_status: "active",
        cancel_at_period_end: true,
        current_period_end: periodEnd,
      }),
    ).toEqual({ kind: "active_canceling", periodEnd: new Date(periodEnd) });
  });

  it("carries pastDueSince for past_due", () => {
    const periodEnd = "2026-06-01T00:00:00Z";
    expect(
      stateFromMeta({ subscription_status: "past_due", current_period_end: periodEnd }),
    ).toEqual({ kind: "past_due", pastDueSince: new Date(periodEnd) });
  });
});

describe("comp_ended", () => {
  it("maps subscription_status=comp_ended to its own kind", () => {
    expect(stateFromMeta({ subscription_status: "comp_ended" })).toEqual({
      kind: "comp_ended",
    });
  });

  it("is distinguishable from missing — the whole point of the state", () => {
    // `missing` means unprovisioned/broken, where checkout is the WRONG
    // remedy; `comp_ended` means a deliberate ops act, where it is the only
    // remedy. Collapsing them would offer a Subscribe button to a firm whose
    // metadata merely failed to write.
    expect(stateFromMeta({ subscription_status: "comp_ended" }).kind).not.toBe("missing");
  });

  it("loses to is_founder — re-comping a firm beats a stale comp_ended status", () => {
    expect(
      stateFromMeta({ is_founder: true, subscription_status: "comp_ended" }),
    ).toEqual({ kind: "founder" });
  });

  it("is overwritten by a real subscription status once they subscribe", () => {
    // The checkout webhook writes subscription_status: sub.status over the
    // top, so the state self-heals with no extra clean-up step.
    expect(stateFromMeta({ subscription_status: "active" })).toEqual({ kind: "active" });
  });
});
