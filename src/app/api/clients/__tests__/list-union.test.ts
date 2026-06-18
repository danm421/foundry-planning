import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts, clients } from "@/db/schema";
import { eq } from "drizzle-orm";

// Mock requireOrgId — the recipient belongs to org_union_own
vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_union_own") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

// Mock the shared-access resolvers
vi.mock("@/lib/clients/shared-access", () => ({
  resolveSharedClientAccess: vi.fn(),
  resolveSharesForRecipient: vi.fn(),
}));

// Mock resolveActors — returns a Map with name info
vi.mock("@/lib/activity/resolve-actors", () => ({
  resolveActors: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import { resolveSharedClientAccess, resolveSharesForRecipient } from "@/lib/clients/shared-access";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { GET } from "../route";

const OWN_ORG = "org_union_own";
const OTHER_ORG = "org_union_other";
const RECIPIENT_USER = "user_recipient";
const OWNER_USER = "user_owner";

async function seedClient(firmId: string, advisorId: string, last: string) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId, name: `${last} HH` })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: h.id,
    role: "primary",
    firstName: "Test",
    lastName: last,
  });
  const [c] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId,
      crmHouseholdId: h.id,
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 95,
      filingStatus: "single",
    })
    .returning();
  return c;
}

describe("GET /api/clients union + access tagging", () => {
  let ownClientId: string;
  let sharedClientId: string;

  beforeEach(async () => {
    // Clean up both orgs
    await db.delete(clients).where(eq(clients.firmId, OWN_ORG));
    await db.delete(clients).where(eq(clients.firmId, OTHER_ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, OWN_ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, OTHER_ORG));

    // Seed one own client + one client from another org (shared to recipient)
    const own = await seedClient(OWN_ORG, RECIPIENT_USER, "OwnLast");
    const shared = await seedClient(OTHER_ORG, OWNER_USER, "SharedLast");
    ownClientId = own.id;
    sharedClientId = shared.id;

    // Auth: recipient is an org:member of OWN_ORG
    vi.mocked(auth).mockResolvedValue({
      userId: RECIPIENT_USER,
      orgId: OWN_ORG,
      orgRole: "org:member",
    } as never);

    // resolveSharedClientAccess returns the shared client id
    vi.mocked(resolveSharedClientAccess).mockResolvedValue({
      sharedClientIds: new Set([sharedClientId]),
      permissionByClientId: new Map([[sharedClientId, "view"]]),
    });

    // resolveSharesForRecipient returns one share detail
    vi.mocked(resolveSharesForRecipient).mockResolvedValue([
      {
        clientId: sharedClientId,
        ownerUserId: OWNER_USER,
        firmId: OTHER_ORG,
        permission: "view",
        scope: "client",
      },
    ]);

    // resolveActors returns a name for the owner
    vi.mocked(resolveActors).mockResolvedValue(
      new Map([[OWNER_USER, { name: "Alice Owner", isSystem: false }]]),
    );
  });

  it("returns own client tagged access:own and shared client tagged access:shared with sharedBy", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const rows = await res.json();

    const own = rows.find((r: { id: string }) => r.id === ownClientId);
    const shared = rows.find((r: { id: string }) => r.id === sharedClientId);

    expect(own).toBeDefined();
    expect(own.access).toBe("own");
    expect(own.sharedBy).toBeNull();

    expect(shared).toBeDefined();
    expect(shared.access).toBe("shared");
    expect(shared.sharedBy).toBe("Alice Owner");
  });
});
