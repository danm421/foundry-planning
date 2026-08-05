import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(m?: string) {
      super(m);
      this.name = "ForbiddenError";
    }
  }
  return { ForbiddenError };
});
vi.mock("@/lib/authz", () => ({ ForbiddenError }));

// Shared call-log array — the three guard mocks below all push onto it. A
// test asserting the log's CONTENTS (order, not just "all three called") is
// the only shape that reddens if resolvePortalWriteContext ever reorders
// identity → subscription → edit-enabled.
let callLog: string[] = [];

let resolvePortalClientResult: {
  clientId: string;
  mode: "client" | "advisor";
  clerkUserId: string;
};
const resolvePortalClientMock = vi.fn(async () => {
  callLog.push("resolvePortalClient");
  return resolvePortalClientResult;
});
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));

const requirePortalActiveSubscriptionMock = vi.fn(async (_clientId: string) => {
  callLog.push("requirePortalActiveSubscription");
});
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: (id: string) => requirePortalActiveSubscriptionMock(id),
}));

const requireEditEnabledMock = vi.fn(async (_clientId: string) => {
  callLog.push("requireEditEnabled");
});
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

vi.mock("@/db/schema", () => ({ clients: { _name: "clients" } }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

let clientRow: Record<string, unknown> | null = { firmId: "firm-1" };
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(clientRow ? [clientRow] : []),
        }),
      }),
    }),
  },
}));

import { resolvePortalWriteContext } from "@/lib/portal/portal-write-context";

beforeEach(() => {
  callLog = [];
  clientRow = { firmId: "firm-1" };
  resolvePortalClientResult = { clientId: "c1", mode: "client", clerkUserId: "user_1" };
  resolvePortalClientMock.mockClear();
  requirePortalActiveSubscriptionMock.mockClear();
  requireEditEnabledMock.mockClear();
});

describe("resolvePortalWriteContext", () => {
  it("runs the three guards in order: identity, then subscription, then edit-enabled", async () => {
    await resolvePortalWriteContext();
    expect(callLog).toEqual([
      "resolvePortalClient",
      "requirePortalActiveSubscription",
      "requireEditEnabled",
    ]);
  });

  it("throws ForbiddenError when the client has no firmId", async () => {
    clientRow = null;
    await expect(resolvePortalWriteContext()).rejects.toThrow(ForbiddenError);
  });

  it("client mode: actorKind is 'client' and auditMeta carries no viaPreview", async () => {
    resolvePortalClientResult = { clientId: "c1", mode: "client", clerkUserId: "user_1" };
    const ctx = await resolvePortalWriteContext();
    expect(ctx.mode).toBe("client");
    expect(ctx.actorKind).toBe("client");
    expect(ctx.auditMeta).toEqual({ via: "portal" });
  });

  it("advisor mode: actorKind is 'advisor' and auditMeta carries viaPreview: true", async () => {
    resolvePortalClientResult = { clientId: "c1", mode: "advisor", clerkUserId: "user_2" };
    const ctx = await resolvePortalWriteContext();
    expect(ctx.mode).toBe("advisor");
    expect(ctx.actorKind).toBe("advisor");
    expect(ctx.auditMeta).toEqual({ via: "portal", viaPreview: true });
  });
});
