import { describe, it, expect, beforeEach, vi } from "vitest";

// Mutable fixtures the mocks below read from — reset in beforeEach so tests
// don't leak state into each other.
let pendingRows: Array<{
  id: string;
  userId: string;
  category: string;
  title: string;
  body: string | null;
  url: string;
  createdAt: Date;
}> = [];
let clerkUsers: Array<{
  id: string;
  primaryEmailAddress: { emailAddress: string } | null;
  firstName: string | null;
  lastName: string | null;
}> = [];
const updateCalls: Array<{ set: unknown; ids: string[] }> = [];
const callOrder: string[] = [];

// `inArray` is the only drizzle-orm helper the assertions below need to see
// through — everything else (and/asc/eq/isNull) stays real since the mocked
// `db.select` chain never inspects its `where` argument.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (_col: unknown, ids: string[]) => ({ __inArray: ids }),
  };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => pendingRows }) }) }),
    }),
    update: () => ({
      set: (patch: unknown) => ({
        where: (cond: { __inArray: string[] }) => {
          callOrder.push("update");
          updateCalls.push({ set: patch, ids: cond.__inArray });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

const sendDigestEmailMock = vi.fn(
  async (_args: { to: string; subject: string; html: string }) => {
    callOrder.push("send");
    return { delivered: true };
  },
);
vi.mock("@/lib/notifications/email", () => ({
  sendDigestEmail: (args: { to: string; subject: string; html: string }) =>
    sendDigestEmailMock(args),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: clerkUsers }) } }),
}));

import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://example.com/api/cron/notification-digest", {
    headers: auth ? { authorization: auth } : {},
  });
}

function row(i: number, overrides: Partial<(typeof pendingRows)[number]> = {}) {
  return {
    id: `row-${i}`,
    userId: "user_1",
    category: "client_birthday",
    title: `Update ${i}`,
    body: null,
    url: "/alerts",
    createdAt: new Date(2026, 0, i + 1),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "secret_t";
  pendingRows = [];
  clerkUsers = [];
  updateCalls.length = 0;
  callOrder.length = 0;
  sendDigestEmailMock.mockReset().mockImplementation(async () => {
    callOrder.push("send");
    return { delivered: true };
  });
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

  it("stamps ALL pending ids for a user, including rows past the render cap", async () => {
    // MAX_ROWS_PER_EMAIL is 50 — 51 rows for one user forces truncation, and
    // the stamp must still cover every one of them (digest.ts's `allIds`
    // contract), not just the 50 that got rendered.
    pendingRows = Array.from({ length: 51 }, (_, i) => row(i));
    clerkUsers = [
      { id: "user_1", primaryEmailAddress: { emailAddress: "advisor@example.com" }, firstName: "Ann", lastName: "Advisor" },
    ];

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      usersEmailed: 1,
      rowsEmailed: 51,
      usersFailed: 0,
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].ids).toHaveLength(51);
  });

  it("sends before it stamps", async () => {
    pendingRows = [row(0)];
    clerkUsers = [
      { id: "user_1", primaryEmailAddress: { emailAddress: "advisor@example.com" }, firstName: "Ann", lastName: "Advisor" },
    ];

    await GET(req("Bearer secret_t") as never);

    expect(callOrder).toEqual(["send", "update"]);
  });

  it("stamps nothing when the send fails, and reports the failure", async () => {
    pendingRows = [row(0)];
    clerkUsers = [
      { id: "user_1", primaryEmailAddress: { emailAddress: "advisor@example.com" }, firstName: "Ann", lastName: "Advisor" },
    ];
    sendDigestEmailMock.mockReset().mockResolvedValue({ delivered: false });

    const res = await GET(req("Bearer secret_t") as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      usersEmailed: 0,
      rowsEmailed: 0,
      usersFailed: 1,
    });
    expect(updateCalls).toHaveLength(0);
  });
});
