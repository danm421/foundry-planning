import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));
vi.mock("@/db/schema", () => ({ portalPushTokens: { _n: "ppt", expoPushToken: "t" } }));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

const insertValuesMock = vi.fn();
const onConflictMock = vi.fn();
const deleteWhereMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        insertValuesMock(v);
        return { onConflictDoUpdate: (c: unknown) => { onConflictMock(c); return Promise.resolve(); } };
      },
    }),
    delete: () => ({ where: (w: unknown) => { deleteWhereMock(w); return Promise.resolve(); } }),
  },
}));

import { POST } from "../route";

function req(body: unknown): Request {
  return new Request("http://x/api/portal/push-tokens", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveMock.mockReset().mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  insertValuesMock.mockReset();
  onConflictMock.mockReset();
});

describe("POST /api/portal/push-tokens", () => {
  it("rejects advisor (act-as) mode with 403", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    const res = await POST(req({ expoPushToken: "ExponentPushToken[a]", platform: "ios" }));
    expect(res.status).toBe(403);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("400s when the token is missing", async () => {
    const res = await POST(req({ platform: "ios" }));
    expect(res.status).toBe(400);
  });

  it("upserts the token with enabled defaulting to true", async () => {
    const res = await POST(req({ expoPushToken: "ExponentPushToken[a]", platform: "ios" }));
    expect(res.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", clerkUserId: "u1", expoPushToken: "ExponentPushToken[a]", platform: "ios", enabled: true }),
    );
    expect(onConflictMock).toHaveBeenCalled();
  });

  it("honors an explicit enabled:false (toggle off)", async () => {
    await POST(req({ expoPushToken: "ExponentPushToken[a]", platform: "ios", enabled: false }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
