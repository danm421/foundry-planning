import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPlaidWebhook = vi.fn();
vi.mock("@/lib/plaid/webhook-verify", () => ({
  verifyPlaidWebhook: (...a: unknown[]) => verifyPlaidWebhook(...a),
}));
const handlers: Record<string, ReturnType<typeof vi.fn>> = {
  "ITEM:PENDING_EXPIRATION": vi.fn(),
};
vi.mock("@/lib/plaid/webhook-handlers", () => ({
  plaidWebhookHandlers: new Proxy({}, { get: (_t, k: string) => handlers[k] }),
}));
const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

const inserted: unknown[] = [];
const updated: unknown[] = [];
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v);
        return { returning: () => Promise.resolve([{ id: "evt-1" }]) };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        updated.push(v);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }),
  },
}));

import { POST } from "../route";

function makeReq(body: unknown, jwt = "jwt-1") {
  return new Request("https://x/api/webhooks/plaid", {
    method: "POST",
    headers: jwt ? { "plaid-verification": jwt } : {},
    body: JSON.stringify(body),
  });
}

const PAYLOAD = { webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", item_id: "p-1", environment: "production" };

beforeEach(() => {
  verifyPlaidWebhook.mockReset();
  handlers["ITEM:PENDING_EXPIRATION"].mockReset();
  captureException.mockReset();
  inserted.length = 0;
  updated.length = 0;
  verifyPlaidWebhook.mockResolvedValue({ ok: true });
});

describe("POST /api/webhooks/plaid", () => {
  it("verification failure → 401, no DB writes", async () => {
    verifyPlaidWebhook.mockResolvedValue({ ok: false, reason: "bad" });
    const res = await POST(makeReq(PAYLOAD) as never);
    expect(res.status).toBe(401);
    expect(inserted).toHaveLength(0);
  });

  it("unparseable body after valid signature → 400", async () => {
    const req = new Request("https://x/", {
      method: "POST",
      headers: { "plaid-verification": "jwt-1" },
      body: "not-json",
    });
    expect((await POST(req as never)).status).toBe(400);
  });

  it("dispatches, logs, and records ok", async () => {
    handlers["ITEM:PENDING_EXPIRATION"].mockResolvedValue("ok");
    const res = await POST(makeReq(PAYLOAD) as never);
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      plaidItemId: "p-1",
      webhookType: "ITEM",
      webhookCode: "PENDING_EXPIRATION",
      environment: "production",
    });
    expect(updated[0]).toMatchObject({ result: "ok" });
    expect(handlers["ITEM:PENDING_EXPIRATION"]).toHaveBeenCalledWith(PAYLOAD);
  });

  it("unknown type:code → ignored, 200", async () => {
    const res = await POST(makeReq({ ...PAYLOAD, webhook_code: "NOPE" }) as never);
    expect(res.status).toBe(200);
    expect(updated[0]).toMatchObject({ result: "ignored" });
  });

  it("handler throw → error row + Sentry + 500", async () => {
    handlers["ITEM:PENDING_EXPIRATION"].mockRejectedValue(new Error("boom"));
    const res = await POST(makeReq(PAYLOAD) as never);
    expect(res.status).toBe(500);
    expect(updated[0]).toMatchObject({ result: "error", errorMessage: expect.stringContaining("boom") });
    expect(captureException).toHaveBeenCalled();
  });
});
