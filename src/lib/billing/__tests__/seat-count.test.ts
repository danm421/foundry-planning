import { describe, it, expect, vi } from "vitest";
import { getOrgMemberCount, expectedSeatQuantity } from "../seat-count";

function fakeClient(list: { data: unknown[]; totalCount?: number }) {
  const getOrganizationMembershipList = vi.fn().mockResolvedValue(list);
  return {
    cc: { organizations: { getOrganizationMembershipList } },
    getOrganizationMembershipList,
  };
}

describe("getOrgMemberCount", () => {
  it("returns the SDK's totalCount — the true count, not the capped page size", async () => {
    // A firm with 150 members returns only the first `limit` page in `data`,
    // but totalCount reports the real total. Reading data.length would undercount.
    const { cc } = fakeClient({
      data: Array.from({ length: 100 }, () => ({})),
      totalCount: 150,
    });
    await expect(getOrgMemberCount(cc, "org_big")).resolves.toBe(150);
  });

  it("falls back to data.length only when totalCount is absent", async () => {
    const { cc } = fakeClient({ data: [{}, {}, {}] });
    await expect(getOrgMemberCount(cc, "org_small")).resolves.toBe(3);
  });

  it("queries the given org", async () => {
    const { cc, getOrganizationMembershipList } = fakeClient({ data: [{}], totalCount: 1 });
    await getOrgMemberCount(cc, "org_x");
    expect(getOrganizationMembershipList).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_x" }),
    );
  });
});

describe("expectedSeatQuantity", () => {
  it("is the member count when at least 1", () => {
    expect(expectedSeatQuantity(5)).toBe(5);
    expect(expectedSeatQuantity(1)).toBe(1);
  });

  it("never bills fewer than 1 seat", () => {
    expect(expectedSeatQuantity(0)).toBe(1);
  });
});
