// A client marked Private is visible inside its firm only to its own advisor
// and firm admins, whatever the firm's book-silo setting. An explicit
// per-client share still grants access. Unit test: `@/db` is a double that
// serves one client row and the staff mapping; the visibility rules are real.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  client: null as Record<string, unknown> | null,
  staffMapping: [] as { advisorUserId: string }[],
  session: { userId: "", orgId: "", orgRole: "" },
  shared: new Map<string, "view" | "edit">(),
}));

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.clients) return m.client ? [m.client] : [];
            if (table === schema.staffAdvisorVisibility) return m.staffMapping;
            throw new Error("unexpected table");
          },
        }),
      }),
    },
  };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => m.session }));
// Book silo OFF: every non-admin member sees every advisor's book, so the
// Private flag is the only thing that can hide a colleague's client.
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => false }));
vi.mock("../shared-access", () => ({
  resolveSharedClientAccess: async () => ({
    sharedClientIds: new Set(m.shared.keys()),
    permissionByClientId: m.shared,
  }),
}));

import { verifyClientAccessFor, requireClientAccess } from "../authz";
import { ForbiddenError } from "@/lib/authz";

const ORG = "org_1";
const OWNER = "adv_owner";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function asCaller(userId: string, orgRole: string) {
  m.session = { userId, orgId: ORG, orgRole };
  return { userId, orgId: ORG, orgRole };
}

beforeEach(() => {
  m.client = { id: CLIENT_ID, firmId: ORG, advisorId: OWNER, isPrivate: true };
  m.staffMapping = [];
  m.shared = new Map();
});

describe("a private client", () => {
  it.each([
    ["a colleague in the same firm", "adv_colleague", "org:member"],
    ["staff mapped to its advisor", "user_planner", "org:planner"],
  ])("is hidden from %s", async (_who, userId, orgRole) => {
    m.staffMapping = [{ advisorUserId: OWNER }];
    const p = asCaller(userId, orgRole);
    await expect(verifyClientAccessFor(p, CLIENT_ID)).resolves.toEqual({ ok: false });
    await expect(requireClientAccess(CLIENT_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each([
    ["its own advisor", OWNER, "org:member"],
    ["a firm admin", "user_admin", "org:admin"],
  ])("stays fully open to %s", async (_who, userId, orgRole) => {
    const p = asCaller(userId, orgRole);
    await expect(verifyClientAccessFor(p, CLIENT_ID)).resolves.toEqual({
      ok: true, permission: "edit", firmId: ORG, access: "own",
    });
    await expect(requireClientAccess(CLIENT_ID)).resolves.toMatchObject({
      permission: "edit", access: "own",
    });
  });

  it("is still reachable by a colleague holding an explicit share, at the shared level", async () => {
    m.shared = new Map([[CLIENT_ID, "view"]]);
    const p = asCaller("adv_colleague", "org:member");
    await expect(verifyClientAccessFor(p, CLIENT_ID)).resolves.toEqual({
      ok: true, permission: "view", firmId: ORG, access: "shared",
    });
    await expect(requireClientAccess(CLIENT_ID)).resolves.toMatchObject({
      permission: "view", access: "shared",
    });
  });
});

describe("a client that is not private", () => {
  it("stays open to a colleague when the firm's books are not siloed", async () => {
    m.client = { ...m.client, isPrivate: false };
    const p = asCaller("adv_colleague", "org:member");
    await expect(verifyClientAccessFor(p, CLIENT_ID)).resolves.toEqual({
      ok: true, permission: "edit", firmId: ORG, access: "own",
    });
  });
});
