import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/db", () => {
  // Every link in the chain is itself awaitable and returns a fresh link, so
  // this satisfies both `.from().innerJoin().where()` and a bare `.from()`.
  const chain = (): never => {
    const link = Promise.resolve([]) as never;
    Object.assign(link, { from: chain, innerJoin: chain, where: chain });
    return link;
  };
  return { db: { select: chain } };
});
vi.mock("@/lib/notifications/enqueue", () => ({ enqueueNotifications: vi.fn() }));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://example.com/api/cron/notification-scan", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "secret_t";
});

describe("GET /api/cron/notification-scan", () => {
  it("401s without an authorization header", async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(401);
  });

  it("401s on a wrong secret", async () => {
    const res = await GET(req("Bearer nope") as never);
    expect(res.status).toBe(401);
  });

  // Fail closed: an unset secret must never mean "open", or a misconfigured
  // preview deployment exposes the endpoint to anyone who sends a bare header.
  it("401s when CRON_SECRET is unset even with a 'Bearer ' header", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer ") as never);
    expect(res.status).toBe(401);
  });

  it("200s with the correct secret", async () => {
    const res = await GET(req("Bearer secret_t") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
