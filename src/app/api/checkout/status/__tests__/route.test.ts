import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutStatusRateLimit: vi.fn(),
  extractClientIp: vi.fn(() => "203.0.113.7"),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { GET } from "../route";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutStatusRateLimit } from "@/lib/rate-limit";
import { db } from "@/db";

function makeRequest(sessionId: string | null) {
  const url = sessionId
    ? `https://app.foundryplanning.com/api/checkout/status?session_id=${sessionId}`
    : `https://app.foundryplanning.com/api/checkout/status`;
  return new Request(url, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
}

function mockSelectChain(rows: Array<{ firmName: string }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, innerJoin, where, limit };
}

describe("GET /api/checkout/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCheckoutStatusRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 59,
      reset: Date.now() + 60_000,
    });
  });

  it("returns ready=false when no subscriptions row exists yet", async () => {
    vi.mocked(getStripe).mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "cs_test_abc123def456ghi789",
            customer: "cus_123",
            customer_details: { email: "buyer@example.com" },
          }),
        },
      },
    } as never);
    mockSelectChain([]);

    const res = await GET(makeRequest("cs_test_abc123def456ghi789"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: false });
  });

  it("returns ready=true with firmName + buyerEmail once the row exists", async () => {
    vi.mocked(getStripe).mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "cs_test_abc123def456ghi789",
            customer: "cus_123",
            customer_details: { email: "buyer@example.com" },
          }),
        },
      },
    } as never);
    mockSelectChain([{ firmName: "Acme Wealth" }]);

    const res = await GET(makeRequest("cs_test_abc123def456ghi789"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ready: true,
      firmName: "Acme Wealth",
      buyerEmail: "buyer@example.com",
    });
  });

  it("400s on missing session_id", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it("400s on malformed session_id", async () => {
    const res = await GET(makeRequest("not-a-real-id"));
    expect(res.status).toBe(400);
  });

  it("404s when Stripe says the session does not exist", async () => {
    vi.mocked(getStripe).mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockRejectedValue(
            Object.assign(new Error("No such checkout.session"), {
              statusCode: 404,
            }),
          ),
        },
      },
    } as never);
    const res = await GET(makeRequest("cs_test_missing000000000000"));
    expect(res.status).toBe(404);
  });

  it("429s when the rate limiter denies", async () => {
    vi.mocked(checkCheckoutStatusRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 5000,
    });
    const res = await GET(makeRequest("cs_test_abc123def456ghi789"));
    expect(res.status).toBe(429);
  });
});
