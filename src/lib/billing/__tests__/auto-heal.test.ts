// src/lib/billing/__tests__/auto-heal.test.ts
import { describe, it, expect } from "vitest";
import { planAutoHeal } from "../auto-heal";
import type { DriftEntry } from "../reconcile";

describe("planAutoHeal", () => {
  it("heals status drift with Stripe's value", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "status", stripeValue: "active", dbValue: "past_due", clerkValue: "past_due" },
    ];
    expect(planAutoHeal(drift)).toEqual({
      firmId: "org_1",
      patch: { subscription_status: "active", past_due_since: null },
      healedFields: ["status"],
    });
  });

  it("heals entitlements drift with Stripe's derived value", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "entitlements", stripeValue: ["ai_import"], clerkValue: [] },
    ];
    expect(planAutoHeal(drift)).toEqual({
      firmId: "org_1",
      patch: { entitlements: ["ai_import"] },
      healedFields: ["entitlements"],
    });
  });

  it("heals both status and entitlements when both drift", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "status", stripeValue: "active", dbValue: "active", clerkValue: "trialing" },
      { firmId: "org_1", field: "entitlements", stripeValue: ["ai_import"], clerkValue: [] },
    ];
    const plan = planAutoHeal(drift);
    expect(plan!.patch).toEqual({
      subscription_status: "active",
      past_due_since: null,
      entitlements: ["ai_import"],
    });
    expect(plan!.healedFields.sort()).toEqual(["entitlements", "status"]);
  });

  it("stays detect-only for ambiguous item drift", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "items", stripeValue: [{ kind: "seat" }], dbValue: [], clerkValue: [] },
    ];
    expect(planAutoHeal(drift)).toBeNull();
  });

  it("ignores item drift but still heals a co-occurring status drift", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "items", stripeValue: [], dbValue: [{ kind: "seat" }], clerkValue: [] },
      { firmId: "org_1", field: "status", stripeValue: "active", dbValue: "active", clerkValue: "missing" },
    ];
    expect(planAutoHeal(drift)).toEqual({
      firmId: "org_1",
      patch: { subscription_status: "active", past_due_since: null },
      healedFields: ["status"],
    });
  });

  it("stays detect-only for seat drift (never auto-moves money)", () => {
    // Seat-quantity drift means real billing changes with proration; the cron
    // must only flag + Sentry-page it, never silently re-charge the customer.
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "seats", stripeValue: 100, clerkValue: 150 },
    ];
    expect(planAutoHeal(drift)).toBeNull();
  });

  it("ignores seat drift but still heals a co-occurring status drift", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "seats", stripeValue: 100, clerkValue: 150 },
      { firmId: "org_1", field: "status", stripeValue: "active", dbValue: "active", clerkValue: "missing" },
    ];
    expect(planAutoHeal(drift)).toEqual({
      firmId: "org_1",
      patch: { subscription_status: "active", past_due_since: null },
      healedFields: ["status"],
    });
  });

  it("returns null for empty drift", () => {
    expect(planAutoHeal([])).toBeNull();
  });

  it("skips a status heal whose stripeValue is the cron's <error> sentinel", () => {
    const drift: DriftEntry[] = [
      { firmId: "org_1", field: "status", stripeValue: "<error>", clerkValue: "boom" },
    ];
    expect(planAutoHeal(drift)).toBeNull();
  });

  describe("the past-due start date", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    const healTo = (status: string): DriftEntry[] => [
      { firmId: "org_1", field: "status", stripeValue: status, dbValue: "x", clerkValue: "x" },
    ];

    it("starts now when the heal makes the firm past due", () => {
      const plan = planAutoHeal(healTo("past_due"), { subscription_status: "active" }, now);
      expect(plan?.patch).toEqual({ subscription_status: "past_due", past_due_since: now.toISOString() });
    });

    it("keeps a recorded start when Clerk already had the firm past due", () => {
      const prev = { subscription_status: "past_due", past_due_since: "2026-10-01T00:00:00.000Z" };
      expect(planAutoHeal(healTo("past_due"), prev, now)?.patch.past_due_since).toBe(
        "2026-10-01T00:00:00.000Z",
      );
    });

    it("clears it when the heal moves the firm off past due", () => {
      const prev = { subscription_status: "past_due", past_due_since: "2026-10-01T00:00:00.000Z" };
      expect(planAutoHeal(healTo("active"), prev, now)?.patch).toEqual({
        subscription_status: "active",
        past_due_since: null,
      });
    });
  });
});
