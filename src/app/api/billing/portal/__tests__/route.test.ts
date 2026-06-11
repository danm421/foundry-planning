import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: vi.fn(),
}));
vi.mock("@/lib/authz", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireBillingContact: vi.fn() };
});
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}));

import { POST } from "../route";
import { getStripe } from "@/lib/billing/stripe-client";
import { requireBillingContact, ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";

// db.select().from().where().orderBy() resolves to an array of rows.
function mockSubscriptionRows(rows: { stripeCustomerId: string }[]) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as never);
}

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://app.foundryplanning.com/api/billing/portal", {
    method: "POST",
    headers: { origin: "https://app.foundryplanning.com", ...headers },
  });
}

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireBillingContact).mockResolvedValue(undefined);
    vi.mocked(auth).mockResolvedValue({ orgId: "org_abc" } as never);
  });

  it("creates a portal session and 303-redirects to its URL", async () => {
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/test_xyz" });
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(makeRequest());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://billing.stripe.com/session/test_xyz",
    );
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
    });
  });

  it("400s with no_subscription when the firm has no Stripe customer", async () => {
    mockSubscriptionRows([]);
    const create = vi.fn();
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_subscription" });
    expect(create).not.toHaveBeenCalled();
  });

  it("403s when the caller is not the org owner", async () => {
    vi.mocked(requireBillingContact).mockRejectedValue(
      new ForbiddenError("Organization owner role required"),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Organization owner role required",
    });
  });

  it("401s when there is no session", async () => {
    vi.mocked(requireBillingContact).mockRejectedValue(new UnauthorizedError());
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400s with no_subscription when the org id is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null } as never);
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_subscription" });
  });

  it("falls back to NEXT_PUBLIC_APP_URL for return_url when Origin is absent", async () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.foundryplanning.com";
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.com/session/test_no_origin" });
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: { sessions: { create } },
    } as never);

    const res = await POST(
      new Request("https://app.foundryplanning.com/api/billing/portal", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(303);
    expect(create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://app.foundryplanning.com/settings/billing",
    });
    process.env.NEXT_PUBLIC_APP_URL = prev;
  });

  it("500s when Stripe throws creating the session", async () => {
    mockSubscriptionRows([{ stripeCustomerId: "cus_123" }]);
    vi.mocked(getStripe).mockReturnValue({
      billingPortal: {
        sessions: { create: vi.fn().mockRejectedValue(new Error("boom")) },
      },
    } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "portal_unavailable" });
  });
});
