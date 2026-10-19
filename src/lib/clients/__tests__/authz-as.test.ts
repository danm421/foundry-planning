// verifyClientAccessAs: a write core's one access check, on the caller's
// principal when it has one (the Claude connector's call has no Clerk session)
// and on the session otherwise. Unit test: `@/db` is a double that serves one
// client row in a siloed firm, so only the client's own advisor gets in.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.clients) return [{ firmId: "org_1", advisorId: "adv_1", isPrivate: false }];
            throw new Error("unexpected table");
          },
        }),
      }),
      query: { firms: { findFirst: async () => ({ bookSiloEnabled: true }) } },
    },
  };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("../shared-access", () => ({
  resolveSharedClientAccess: async () => ({ sharedClientIds: new Set(), permissionByClientId: new Map() }),
}));

import { verifyClientAccessAs } from "../authz";

const p = { userId: "adv_1", orgId: "org_1", orgRole: "org:member" };

beforeEach(() => {
  m.auth.mockReset();
});

describe("verifyClientAccessAs", () => {
  it("uses the principal when one is passed and never reads the session", async () => {
    m.auth.mockRejectedValue(new Error("no Clerk session on a connector call"));
    await expect(verifyClientAccessAs(p, "c1")).resolves.toEqual({
      ok: true, permission: "edit", access: "own", firmId: "org_1",
    });
    expect(m.auth).not.toHaveBeenCalled();
  });

  it("reads the session when no principal is passed", async () => {
    m.auth.mockResolvedValue(p);
    await expect(verifyClientAccessAs(undefined, "c1")).resolves.toEqual({
      ok: true, permission: "edit", access: "own", firmId: "org_1",
    });
    expect(m.auth).toHaveBeenCalledTimes(1);
  });
});
