// With the firm's book silo on, a non-admin advisor reaches only the CRM
// households in their own book. Another advisor's household answers exactly
// like a missing one. Unit test: the database, Clerk session and firm setting
// are faked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "org_silo";
const OTHERS_HOUSEHOLD = { id: "hh-a", firmId: ORG, advisorId: "adv_a", name: "A", nameIsCustom: true, status: "active" };

const session = vi.hoisted(() => ({ userId: "adv_b", orgId: "org_silo", orgRole: "org:member" }));
const siloOn = vi.hoisted(() => ({ value: true }));
const dbWrites = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => session }));
vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => siloOn.value }));
vi.mock("@/db", () => ({
  db: {
    query: { crmHouseholds: { findFirst: async () => OTHERS_HOUSEHOLD } },
    update: () => {
      dbWrites();
      return { set: () => ({ where: () => ({ returning: async () => [OTHERS_HOUSEHOLD] }) }) };
    },
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("../activity", () => ({ recordActivity: async () => undefined }));

import { requireCrmHouseholdAccess } from "../authz";
import { getCrmHousehold, updateCrmHousehold } from "../households";

beforeEach(() => {
  Object.assign(session, { userId: "adv_b", orgId: ORG, orgRole: "org:member" });
  siloOn.value = true;
  dbWrites.mockClear();
});

describe("CRM household access under the book silo", () => {
  it("refuses another advisor's household with the not-found error", async () => {
    await expect(requireCrmHouseholdAccess("hh-a")).rejects.toThrow(/not found or access denied/);
  });

  it("reads another advisor's household as missing", async () => {
    expect(await getCrmHousehold("hh-a")).toBeUndefined();
  });

  it("refuses to update another advisor's household", async () => {
    await expect(updateCrmHousehold("hh-a", { status: "inactive" })).rejects.toThrow("Household not found");
    expect(dbWrites).not.toHaveBeenCalled();
  });

  it("allows the household's own advisor", async () => {
    session.userId = "adv_a";
    await expect(requireCrmHouseholdAccess("hh-a")).resolves.toMatchObject({ orgId: ORG });
    expect(await getCrmHousehold("hh-a")).toMatchObject({ id: "hh-a" });
  });

  it("allows a firm admin", async () => {
    session.orgRole = "org:admin";
    await expect(requireCrmHouseholdAccess("hh-a")).resolves.toMatchObject({ orgId: ORG });
  });

  it("leaves a firm without the silo firm-wide", async () => {
    siloOn.value = false;
    await expect(requireCrmHouseholdAccess("hh-a")).resolves.toMatchObject({ orgId: ORG });
    await updateCrmHousehold("hh-a", { status: "inactive" });
    expect(dbWrites).toHaveBeenCalled();
  });
});
