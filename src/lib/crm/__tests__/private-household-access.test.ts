// A household whose planning client is marked Private is visible inside its
// firm only to that client's advisor and firm admins, on the web CRM gate and
// the MCP doorway alike. Unit test: `@/db` serves one household row; the book
// rule is real, with book silo OFF so it alone would let every member in.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  household: null as Record<string, unknown> | null,
  session: { userId: "", orgId: "", orgRole: "" },
}));

vi.mock("@/db", () => ({
  db: { query: { crmHouseholds: { findFirst: async () => m.household } } },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => m.session }));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: async () => m.session.orgId,
}));
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => false }));

import { findVisibleCrmHousehold, verifyCrmHouseholdAccessFor } from "../authz";

const ORG = "org_1";
const OWNER = "adv_owner";

function asCaller(userId: string, orgRole: string) {
  m.session = { userId, orgId: ORG, orgRole };
  return { userId, orgId: ORG, orgRole };
}

async function expectOpenTo(userId: string, orgRole: string) {
  const p = asCaller(userId, orgRole);
  await expect(findVisibleCrmHousehold("hh1")).resolves.toMatchObject({ orgId: ORG });
  await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toMatchObject({ ok: true });
}

beforeEach(() => {
  m.household = {
    id: "hh1",
    firmId: ORG,
    advisorId: OWNER,
    deletedAt: null,
    planningClient: { isPrivate: true, advisorId: OWNER },
  };
});

describe("a household whose planning client is private", () => {
  it("is hidden from a colleague in the same firm", async () => {
    const p = asCaller("adv_colleague", "org:member");
    await expect(findVisibleCrmHousehold("hh1")).resolves.toBeNull();
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
  });

  it.each([
    ["the client's advisor", OWNER, "org:member"],
    ["a firm admin", "user_admin", "org:admin"],
  ])("stays open to %s", (_who, userId, orgRole) => expectOpenTo(userId, orgRole));

  it("hands callers the household row without the planning-client lookup", async () => {
    asCaller(OWNER, "org:member");
    const access = await findVisibleCrmHousehold("hh1");
    expect(access?.household).not.toHaveProperty("planningClient");
  });
});

describe("a household that is not private", () => {
  it.each([
    ["a planning client", { isPrivate: false, advisorId: OWNER }],
    ["no planning client yet", null],
  ])("stays open to a colleague when it has %s", async (_what, planningClient) => {
    m.household = { ...m.household, planningClient };
    await expectOpenTo("adv_colleague", "org:member");
  });
});
