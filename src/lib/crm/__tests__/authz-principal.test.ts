import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirst, callerMaySeeAdvisor } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  callerMaySeeAdvisor: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { query: { crmHouseholds: { findFirst } } } }));
vi.mock("@/lib/clients/authz", () => ({ callerMaySeeAdvisor }));

import { verifyCrmHouseholdAccessFor } from "../authz";
import type { Principal } from "@/lib/clients/authz";

const p: Principal = { userId: "user_1", orgId: "org_1", orgRole: "org:member" } as Principal;

beforeEach(() => {
  findFirst.mockReset();
  callerMaySeeAdvisor.mockReset();
});

describe("verifyCrmHouseholdAccessFor", () => {
  it("allows a visible household in the caller's firm", async () => {
    findFirst.mockResolvedValue({ id: "hh1", firmId: "org_1", advisorId: "user_1", deletedAt: null });
    callerMaySeeAdvisor.mockResolvedValue(true);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({
      ok: true, firmId: "org_1", advisorId: "user_1",
    });
  });

  it("denies a household in another firm", async () => {
    findFirst.mockResolvedValue({ id: "hh1", firmId: "org_OTHER", advisorId: "user_1", deletedAt: null });
    callerMaySeeAdvisor.mockResolvedValue(true);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
  });

  it("denies a colleague's household the caller cannot see", async () => {
    // The case requireCrmHouseholdAccess would have ALLOWED — it is firm-wide.
    findFirst.mockResolvedValue({ id: "hh1", firmId: "org_1", advisorId: "user_2", deletedAt: null });
    callerMaySeeAdvisor.mockResolvedValue(false);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
  });

  it("denies a household in the Trash", async () => {
    findFirst.mockResolvedValue({
      id: "hh1", firmId: "org_1", advisorId: "user_1", deletedAt: new Date("2026-09-01"),
    });
    callerMaySeeAdvisor.mockResolvedValue(true);
    await expect(verifyCrmHouseholdAccessFor(p, "hh1")).resolves.toEqual({ ok: false });
  });

  it("denies a household that does not exist", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(verifyCrmHouseholdAccessFor(p, "nope")).resolves.toEqual({ ok: false });
    expect(callerMaySeeAdvisor).not.toHaveBeenCalled();
  });
});
