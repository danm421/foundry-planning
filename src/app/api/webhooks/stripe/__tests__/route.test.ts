import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => mockConstructEvent(...a) },
    subscriptions: { retrieve: (...a: unknown[]) => mockSubscriptionsRetrieve(...a) },
  }),
}));

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => mockInsert() }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => mockUpdate() }) }),
  },
}));

import { POST } from "../route";

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockInsert.mockReset();
  mockUpdate.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

function makeReq(body: string, sig: string | null = "t=1,v1=sig"): Request {
  const headers: Record<string, string> = {};
  if (sig !== null) headers["stripe-signature"] = sig;
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  });
}

describe("POST /api/webhooks/stripe", () => {
  it("returns 500 when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(500);
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const res = await POST(makeReq("{}", null) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 on signature verification failure", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(400);
  });

  it("returns 200 skipped_duplicate on idempotency hit", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_dup",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });
    mockInsert.mockResolvedValue([]);
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, result: "skipped_duplicate" });
  });

  it("returns 200 ignored for unknown event types", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_unknown",
      type: "totally.unknown.event",
      data: { object: {} },
    });
    mockInsert.mockResolvedValue([{ id: "row_1" }]);
    mockUpdate.mockResolvedValue(undefined);
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("ignored");
  });
});
