import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConstructEvent = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ webhooks: { constructEvent: (...a: unknown[]) => mockConstructEvent(...a) } }),
}));

const mockHandler = vi.fn();
vi.mock("@/lib/billing/webhook-handlers", () => ({
  handlers: { "invoice.payment_failed": (...a: unknown[]) => mockHandler(...a) },
}));

// Chainable db mock: insert→values→onConflictDoNothing→returning, update→set→where.
const mockInsertReturning = vi.fn();
const mockUpdateWhere = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: () => mockInsertReturning() }) }),
    }),
    update: () => ({ set: () => ({ where: () => mockUpdateWhere() }) }),
  },
}));
vi.mock("@/db/schema", () => ({ billingEvents: { id: "id" } }));

const mockCaptureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => mockCaptureException(...a),
}));

import { POST } from "../route";

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockHandler.mockReset();
  mockInsertReturning.mockReset();
  mockUpdateWhere.mockReset();
  mockCaptureException.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_t";
  mockInsertReturning.mockResolvedValue([{ id: "row_1" }]);
  mockUpdateWhere.mockResolvedValue(undefined);
});

function req(): import("next/server").NextRequest {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig_t" },
    body: "{}",
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/webhooks/stripe — Sentry on handler failure", () => {
  it("captures the exception and still returns 500 when a handler throws", async () => {
    mockConstructEvent.mockReturnValue({ id: "evt_1", type: "invoice.payment_failed" });
    mockHandler.mockRejectedValue(new Error("handler boom"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [errArg, ctxArg] = mockCaptureException.mock.calls[0]!;
    expect((errArg as Error).message).toBe("handler boom");
    expect(ctxArg).toMatchObject({
      extra: { eventType: "invoice.payment_failed", eventId: "evt_1" },
    });
  });

  it("does NOT capture when the handler succeeds", async () => {
    mockConstructEvent.mockReturnValue({ id: "evt_2", type: "invoice.payment_failed" });
    mockHandler.mockResolvedValue(undefined);

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
