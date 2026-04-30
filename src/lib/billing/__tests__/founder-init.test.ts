import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Clerk SDK before importing the module under test.
const mockGetOrg = vi.fn();
const mockUpdateOrg = vi.fn();
const mockUpdateOrgMetadata = vi.fn();
const mockUpdateMembership = vi.fn();
const mockGetMembershipList = vi.fn();
const mockGetUserList = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganization: mockGetOrg,
      updateOrganization: mockUpdateOrg,
      updateOrganizationMetadata: mockUpdateOrgMetadata,
      updateOrganizationMembership: mockUpdateMembership,
      getOrganizationMembershipList: mockGetMembershipList,
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
import { getFounderState, applyFounderState } from "../founder-init";

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
        "membership.role",
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
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:owner",
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
        }),
      }),
    );
    expect(mockUpdateMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: TEST_FIRM_ID,
        userId: TEST_USER_ID,
        role: "org:owner",
      }),
    );
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
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:owner",
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
    // Org already founder + owner promoted, but firms row missing.
    mockGetOrg.mockResolvedValue({
      id: TEST_FIRM_ID,
      name: "Foundry HQ",
      publicMetadata: {
        is_founder: true,
        subscription_status: "founder",
        entitlements: ["ai_import"],
      },
    });
    mockGetMembershipList.mockResolvedValue({
      data: [
        {
          publicUserData: { userId: TEST_USER_ID, identifier: OWNER_EMAIL },
          role: "org:owner",
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
