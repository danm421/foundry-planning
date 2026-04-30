import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

import { getSubscriptionState } from "../subscription-state";

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
    expect(await getSubscriptionState()).toEqual({ kind: "past_due" });
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
});
