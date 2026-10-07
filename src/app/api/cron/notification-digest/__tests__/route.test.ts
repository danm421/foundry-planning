import { describe, it, expect, beforeEach, vi } from "vitest";

// Mutable fixtures the mocks below read from — reset in beforeEach so tests
// don't leak state into each other.
let pendingRows: Array<{
  id: string;
  firmId: string;
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
// Each firm's current Clerk members, or the error reading them throws.
let firmMembers: Record<string, string[] | Error> = {};
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
  clerkClient: async () => ({
    users: { getUserList: async () => ({ data: clerkUsers }) },
    organizations: {
      getOrganizationMembershipList: async (p: { organizationId: string; limit: number; offset?: number }) => {
        const members = firmMembers[p.organizationId] ?? [];
        if (members instanceof Error) throw members;
        const offset = p.offset ?? 0;
        return {
          data: members.slice(offset, offset + p.limit).map((userId) => ({ publicUserData: { userId } })),
          totalCount: members.length,
        };
      },
    },
  }),
}));

import { ClerkAPIResponseError } from "@clerk/nextjs/errors";
import { GET } from "../route";

function req(auth?: string): Request {
  return new Request("https://example.com/api/cron/notification-digest", {
    headers: auth ? { authorization: auth } : {},
  });
}

function row(i: number, overrides: Partial<(typeof pendingRows)[number]> = {}) {
  return {
    id: `row-${i}`,
    firmId: "firm_1",
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
  firmMembers = { firm_1: ["user_1"] };
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

  describe("firm membership", () => {
    const ann = { id: "user_1", primaryEmailAddress: { emailAddress: "advisor@example.com" }, firstName: "Ann", lastName: "Advisor" };
    const gone = { id: "user_gone", primaryEmailAddress: { emailAddress: "former@example.com" }, firstName: null, lastName: null };

    it("emails only current members of the row's firm and clears a removed member's rows", async () => {
      pendingRows = [row(0, { userId: "user_gone" }), row(1)];
      clerkUsers = [ann, gone];

      const res = await GET(req("Bearer secret_t") as never);

      expect(sendDigestEmailMock).toHaveBeenCalledTimes(1);
      expect(sendDigestEmailMock.mock.calls[0][0].to).toBe("advisor@example.com");
      expect(updateCalls).toContainEqual({ set: { emailPending: false }, ids: ["row-0"] });
      await expect(res.json()).resolves.toMatchObject({ usersEmailed: 1, rowsEmailed: 1 });
    });

    it("leaves a firm's rows pending, unsent, when its member list can't be read", async () => {
      pendingRows = [row(0), row(1, { firmId: "firm_2", userId: "user_2" })];
      clerkUsers = [ann, { ...ann, id: "user_2", primaryEmailAddress: { emailAddress: "two@example.com" } }];
      firmMembers = { firm_1: new Error("Clerk unavailable"), firm_2: ["user_2"] };

      await GET(req("Bearer secret_t") as never);

      expect(sendDigestEmailMock).toHaveBeenCalledTimes(1);
      expect(sendDigestEmailMock.mock.calls[0][0].to).toBe("two@example.com");
      expect(updateCalls.flatMap((c) => c.ids)).not.toContain("row-0");
    });

    it("finds a member past the first page of the firm's member list", async () => {
      pendingRows = [row(0)];
      clerkUsers = [ann];
      firmMembers = { firm_1: [...Array.from({ length: 150 }, (_, i) => `user_x${i}`), "user_1"] };

      await GET(req("Bearer secret_t") as never);

      expect(sendDigestEmailMock).toHaveBeenCalledTimes(1);
    });

    it("clears the rows of a firm whose organization no longer exists", async () => {
      pendingRows = [row(0)];
      clerkUsers = [ann];
      firmMembers = {
        firm_1: new ClerkAPIResponseError("Not Found", {
          data: [{ code: "resource_not_found", message: "Not Found" }],
          status: 404,
        }),
      };

      await GET(req("Bearer secret_t") as never);

      expect(sendDigestEmailMock).not.toHaveBeenCalled();
      expect(updateCalls).toContainEqual({ set: { emailPending: false }, ids: ["row-0"] });
    });
  });
});
