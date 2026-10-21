// A share of a household's planning client opens its CRM record too: at the
// share's level for the record itself, and the documents vault for an edit
// share only. Unit test: `@/db` serves one household row and the share
// resolver is stubbed; book silo is ON, so a member's own book is theirs alone
// and the share is the only way in.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  household: null as Record<string, unknown> | null,
  session: { userId: "", orgId: "", orgRole: "" },
  shares: new Map<string, "view" | "edit">(),
  silo: true,
}));

vi.mock("@/db", () => ({
  db: { query: { crmHouseholds: { findFirst: async () => m.household } } },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => m.session }));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: async () => m.session.orgId,
}));
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => m.silo }));
vi.mock("@/lib/clients/shared-access", () => ({
  resolveSharedClientAccess: async () => ({
    sharedClientIds: new Set(m.shares.keys()),
    permissionByClientId: m.shares,
  }),
}));

import { ForbiddenError } from "@/lib/authz";
import {
  findVisibleCrmHousehold,
  requireCrmHouseholdEditAccess,
  requireVaultAccess,
} from "../authz";

const ORG = "org_1";
const OWNER = "adv_owner";
const RECIPIENT = "adv_recipient";

function asCaller(userId: string, orgRole = "org:member") {
  m.session = { userId, orgId: ORG, orgRole };
}

beforeEach(() => {
  m.shares = new Map();
  m.silo = true;
  m.household = {
    id: "hh1",
    firmId: ORG,
    advisorId: OWNER,
    deletedAt: null,
    planningClient: { id: "client1", isPrivate: false, advisorId: OWNER },
  };
});

describe("a household shared to a colleague in a siloed firm", () => {
  it("stays hidden without a share", async () => {
    asCaller(RECIPIENT);
    await expect(findVisibleCrmHousehold("hh1")).resolves.toBeNull();
  });

  it("stays hidden when the share is of a different client", async () => {
    asCaller(RECIPIENT);
    m.shares.set("client2", "edit");
    await expect(findVisibleCrmHousehold("hh1")).resolves.toBeNull();
  });

  it.each(["view", "edit"] as const)("opens at the share's level for a %s share", async (level) => {
    asCaller(RECIPIENT);
    m.shares.set("client1", level);
    await expect(findVisibleCrmHousehold("hh1")).resolves.toMatchObject({
      orgId: ORG,
      permission: level,
      household: { id: "hh1" },
    });
  });

  it("honors an explicit share of a Private client", async () => {
    asCaller(RECIPIENT);
    m.household = { ...m.household, planningClient: { id: "client1", isPrivate: true, advisorId: OWNER } };
    m.shares.set("client1", "view");
    await expect(findVisibleCrmHousehold("hh1")).resolves.toMatchObject({ permission: "view" });
  });

  it("gives the owner edit without a share", async () => {
    asCaller(OWNER);
    await expect(findVisibleCrmHousehold("hh1")).resolves.toMatchObject({ permission: "edit" });
  });

  it("refuses a write on a view share and allows one on an edit share", async () => {
    asCaller(RECIPIENT);
    m.shares.set("client1", "view");
    await expect(requireCrmHouseholdEditAccess("hh1")).rejects.toBeInstanceOf(ForbiddenError);
    m.shares.set("client1", "edit");
    await expect(requireCrmHouseholdEditAccess("hh1")).resolves.toMatchObject({ permission: "edit" });
  });
});

describe("the documents vault of a shared household", () => {
  it("opens for an edit share", async () => {
    asCaller(RECIPIENT);
    m.shares.set("client1", "edit");
    await expect(requireVaultAccess("hh1")).resolves.toMatchObject({ orgId: ORG });
  });

  it("stays closed to a view share", async () => {
    asCaller(RECIPIENT);
    m.shares.set("client1", "view");
    await expect(requireVaultAccess("hh1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("opens for an edit share where the caller already sees the household", async () => {
    // Without a silo every member sees every household but is held to their
    // own vault; the share is what opens this one.
    m.silo = false;
    asCaller(RECIPIENT);
    await expect(requireVaultAccess("hh1")).rejects.toBeInstanceOf(ForbiddenError);
    m.shares.set("client1", "edit");
    await expect(requireVaultAccess("hh1")).resolves.toMatchObject({ orgId: ORG });
  });
});
