import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Clerk SDK before importing the module under test.
const mockGetOrg = vi.fn();
const mockUpdateOrg = vi.fn();
const mockUpdateOrgMetadata = vi.fn();
const mockUpdateMembership = vi.fn();
const mockGetMembershipList = vi.fn();
const mockGetUserList = vi.fn();
const mockCreateOrg = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganization: mockGetOrg,
      updateOrganization: mockUpdateOrg,
      updateOrganizationMetadata: mockUpdateOrgMetadata,
      updateOrganizationMembership: mockUpdateMembership,
      getOrganizationMembershipList: mockGetMembershipList,
      createOrganization: mockCreateOrg,
    },
    users: {
      getUserList: mockGetUserList,
    },
  }),
}));

// Mock audit so test doesn't need the audit_log table.
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => {}),
}));

import { db } from "@/db";
import { firms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { getFounderState, applyFounderState, createFounderOrgForUser } from "../founder-init";

const TEST_FIRM_ID = "org_test_founder_init_xyz";
const TEST_USER_ID = "user_test_founder_xyz";
const OWNER_EMAIL = "danmueller20@gmail.com";

beforeEach(async () => {
  vi.clearAllMocks();
  // Clean up any prior test row.
  await db.delete(firms).where(eq(firms.firmId, TEST_FIRM_ID));
});

describe("getFounderState", () => {
  it("reports drift when org name + metadata + role + firms row are all wrong", async () => {
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Retail",
      publicMetadata: {},
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:admin",
          id: "mem_1",
        },
      ],
    });

    const state = await getFounderState({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      ownerUserId: TEST_USER_ID,
      entitlements: ["ai_import"],
    });

    expect(state.drift).toEqual(
      expect.arrayContaining([
        "name",
        "metadata.is_founder",
        "metadata.subscription_status",
        "metadata.entitlements",
        "metadata.billing_contact",
        "firms.row",
      ]),
    );
  });

  it("reports no drift once everything is in target state", async () => {
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Foundry HQ",
      publicMetadata: {
        is_founder: true,
        subscription_status: "founder",
        entitlements: ["ai_import"],
        billing_contact_userId: TEST_USER_ID,
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:admin",
          id: "mem_1",
        },
      ],
    });
    await db.insert(firms).values({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      isFounder: true,
    });

    const state = await getFounderState({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      ownerUserId: TEST_USER_ID,
      entitlements: ["ai_import"],
    });

    expect(state.drift).toEqual([]);
  });
});

describe("applyFounderState", () => {
  it("renames org, sets metadata, promotes role, inserts firms row, audits", async () => {
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Retail",
      publicMetadata: {},
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:admin",
          id: "mem_1",
        },
      ],
    });
    mockUpdateOrg.mockResolvedValue({});
    mockUpdateOrgMetadata.mockResolvedValue({});
    mockUpdateMembership.mockResolvedValue({});

    await applyFounderState({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      ownerUserId: TEST_USER_ID,
      entitlements: ["ai_import"],
    });

    // Clerk SDK signature: updateOrganization(organizationId, params).
    expect(mockUpdateOrg).toHaveBeenCalledWith(
      TEST_FIRM_ID,
      expect.objectContaining({ name: "Foundry HQ" }),
    );
    // Clerk SDK signature: updateOrganizationMetadata(organizationId, params).
    expect(mockUpdateOrgMetadata).toHaveBeenCalledWith(
      TEST_FIRM_ID,
      expect.objectContaining({
        publicMetadata: expect.objectContaining({
          is_founder: true,
          subscription_status: "founder",
          entitlements: ["ai_import"],
          billing_contact_userId: TEST_USER_ID,
        }),
      }),
    );
    // createdBy already makes the user org:admin — no role promotion needed.
    expect(mockUpdateMembership).not.toHaveBeenCalled();
    const rows = await db.select().from(firms).where(eq(firms.firmId, TEST_FIRM_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0].isFounder).toBe(true);
    expect(rows[0].displayName).toBe("Foundry HQ");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.founder_initialized",
        firmId: TEST_FIRM_ID,
        actorId: "system:founder-init",
      }),
    );
  });

  it("is idempotent — second run with same target makes zero Clerk writes and no duplicate firms row", async () => {
    // Seed already-applied state.
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Foundry HQ",
      publicMetadata: {
        is_founder: true,
        subscription_status: "founder",
        entitlements: ["ai_import"],
        billing_contact_userId: TEST_USER_ID,
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:admin",
          id: "mem_1",
        },
      ],
    });
    await db.insert(firms).values({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      isFounder: true,
    });

    await applyFounderState({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      ownerUserId: TEST_USER_ID,
      entitlements: ["ai_import"],
    });

    expect(mockUpdateOrg).not.toHaveBeenCalled();
    expect(mockUpdateOrgMetadata).not.toHaveBeenCalled();
    expect(mockUpdateMembership).not.toHaveBeenCalled();
    const rows = await db.select().from(firms).where(eq(firms.firmId, TEST_FIRM_ID));
    expect(rows).toHaveLength(1);
    // No-op runs do not re-audit.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("partial drift — only fixes the drifted fields", async () => {
    // Org already founder + admin role + billing contact pinned, but firms row missing.
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Foundry HQ",
      publicMetadata: {
        is_founder: true,
        subscription_status: "founder",
        entitlements: ["ai_import"],
        billing_contact_userId: TEST_USER_ID,
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:admin",
          id: "mem_1",
        },
      ],
    });

    await applyFounderState({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      ownerUserId: TEST_USER_ID,
      entitlements: ["ai_import"],
    });

    expect(mockUpdateOrg).not.toHaveBeenCalled();
    expect(mockUpdateOrgMetadata).not.toHaveBeenCalled();
    expect(mockUpdateMembership).not.toHaveBeenCalled();
    const rows = await db.select().from(firms).where(eq(firms.firmId, TEST_FIRM_ID));
    expect(rows).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.founder_initialized",
        metadata: expect.objectContaining({ drift: ["firms.row"] }),
      }),
    );
  });

  it("repairs a drifted membership role — promotes a non-admin owner back to org:admin", async () => {
    // Everything is already in target state EXCEPT the owner's role, which has
    // drifted to org:member. Exercises the membership.role repair backstop.
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Foundry HQ",
      publicMetadata: {
        is_founder: true,
        subscription_status: "founder",
        entitlements: ["ai_import"],
        billing_contact_userId: TEST_USER_ID,
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:member",
          id: "mem_1",
        },
      ],
    });
    await db.insert(firms).values({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      isFounder: true,
    });
    mockUpdateMembership.mockResolvedValue({});

    await applyFounderState({
      firmId: TEST_FIRM_ID,
      displayName: "Foundry HQ",
      ownerUserId: TEST_USER_ID,
      entitlements: ["ai_import"],
    });

    // Only the role drifted: the membership is promoted to org:admin, and no
    // org-name or metadata writes fire.
    expect(mockUpdateMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: TEST_FIRM_ID,
        userId: TEST_USER_ID,
        role: "org:admin",
      }),
    );
    expect(mockUpdateOrg).not.toHaveBeenCalled();
    expect(mockUpdateOrgMetadata).not.toHaveBeenCalled();
  });

  it("throws when the named owner email is not a member of the org", async () => {
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Retail",
      publicMetadata: {},
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: "user_someone_else", identifier: "other@example.com" },
          role: "org:admin",
          id: "mem_2",
        },
      ],
    });

    await expect(
      applyFounderState({
        firmId: TEST_FIRM_ID,
        displayName: "Foundry HQ",
        ownerUserId: TEST_USER_ID,
        entitlements: ["ai_import"],
      }),
    ).rejects.toThrow(/not a member/i);
  });
});

describe("createFounderOrgForUser", () => {
  const NEW_ORG = "org_beta_new";

  afterEach(async () => {
    await db.delete(firms).where(eq(firms.firmId, NEW_ORG));
  });

  it("creates the Clerk org with createdBy, then applies founder state", async () => {
    mockCreateOrg.mockResolvedValue({ id: NEW_ORG, name: "Acme", publicMetadata: {} });
    mockGetOrg.mockResolvedValue({ id: NEW_ORG, name: "Acme", publicMetadata: {} });
    mockGetMembershipList.mockResolvedValue({
      data: [{ publicUserData: { userId: TEST_USER_ID }, role: "org:admin", id: "mem_1" }],
    });
    mockUpdateOrg.mockResolvedValue({});
    mockUpdateOrgMetadata.mockResolvedValue({});
    mockUpdateMembership.mockResolvedValue({});

    const result = await createFounderOrgForUser({
      ownerUserId: TEST_USER_ID,
      displayName: "Acme",
      entitlements: ["ai_import"],
    });

    expect(result).toEqual({ firmId: NEW_ORG });
    expect(mockCreateOrg).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme", createdBy: TEST_USER_ID }),
    );
    const [row] = await db.select().from(firms).where(eq(firms.firmId, NEW_ORG));
    expect(row?.isFounder).toBe(true);
  });
});
