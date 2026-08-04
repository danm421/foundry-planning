import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }) }) }),
    }),
  },
}));
vi.mock("@/lib/notifications/email", () => ({
  sendDigestEmail: vi.fn().mockResolvedValue({ delivered: true }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://example.com/api/cron/notification-digest", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "secret_t";
});

describe("GET /api/cron/notification-digest", () => {
  it("401s without an authorization header", async () => {
    expect((await GET(req() as never)).status).toBe(401);
  });

  it("401s on a wrong secret", async () => {
    expect((await GET(req("Bearer nope") as never)).status).toBe(401);
  });

  it("401s when CRON_SECRET is unset even with a 'Bearer ' header", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer ") as never)).status).toBe(401);
  });

  it("200s and reports zero work when nothing is pending", async () => {
    const res = await GET(req("Bearer secret_t") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      usersEmailed: 0,
      rowsEmailed: 0,
    });
  });
});
