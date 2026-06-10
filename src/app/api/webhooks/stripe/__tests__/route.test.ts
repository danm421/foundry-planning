import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConstructEvent = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => mockConstructEvent(...a) },
  }),
}));

// db.insert(...).onConflictDoNothing().returning() resolves mockInsert();
// db.select(...).from().where() resolves mockSelectResult() (conflict re-read);
// db.update(...).set().where() resolves mockUpdate().
const mockInsert = vi.fn();
const mockSelectResult = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => mockInsert() }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => mockSelectResult() }) }),
    update: () => ({ set: () => ({ where: () => mockUpdate() }) }),
  },
}));

// Handler dispatch table — controllable per test.
const mockHandler = vi.fn();
vi.mock("@/lib/billing/webhook-handlers", () => ({
  handlers: {
    "customer.subscription.updated": (...a: unknown[]) => mockHandler(...a),
  },
}));

import { POST } from "../route";

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockInsert.mockReset();
  mockSelectResult.mockReset();
  mockUpdate.mockReset();
  mockHandler.mockReset();
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

  it("soc2: CC6.6 unsigned Stripe webhook returns 400 with no DB write", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(400);
  });

  it("soc2: CC7.5 duplicate of a TERMINAL-SUCCESS event returns skipped_duplicate, no work", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_dup",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });
    mockInsert.mockResolvedValue([]); // ON CONFLICT DO NOTHING → no row returned
    mockSelectResult.mockResolvedValue([{ id: "row_dup", result: "ok" }]);
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, result: "skipped_duplicate" });
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("re-runs the handler when a prior delivery is in error (replayable retry)", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_retry",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });
    mockInsert.mockResolvedValue([]); // conflict: row already exists
    mockSelectResult.mockResolvedValue([{ id: "row_err", result: "error" }]); // prior failure
    mockHandler.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);

    const res = await POST(makeReq("{}") as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, result: "ok" });
    expect(mockHandler).toHaveBeenCalledTimes(1); // NOT skipped_duplicate
    expect(mockUpdate).toHaveBeenCalled(); // row flipped error → ok
  });

  it("re-runs the handler when a prior delivery is still pending (result null)", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_pending",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });
    mockInsert.mockResolvedValue([]);
    mockSelectResult.mockResolvedValue([{ id: "row_pending", result: null }]);
    mockHandler.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);

    const res = await POST(makeReq("{}") as never);

    expect(res.status).toBe(200);
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it("returns 200 ignored for unknown event types", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_unknown",
      type: "totally.unknown.event",
      data: { object: {} },
    });
    mockInsert.mockResolvedValue([{ id: "row_1" }]); // fresh insert
    mockUpdate.mockResolvedValue(undefined);
    const res = await POST(makeReq("{}") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("ignored");
  });
});
