import { describe, it, expect, vi, beforeEach } from "vitest";

const loadHouseholdBrand = vi.fn();
vi.mock("@/lib/branding/household-brand", () => ({
  loadHouseholdBrand: (...a: unknown[]) => loadHouseholdBrand(...a),
}));

import { resolveFormBrand } from "../form-brand";

describe("resolveFormBrand", () => {
  beforeEach(() => loadHouseholdBrand.mockReset().mockResolvedValue("user_bob"));

  it("a form's own brand wins, with no lookup", async () => {
    expect(await resolveFormBrand("org_a", "c1", "firm", "user_c")).toBe("firm");
    expect(loadHouseholdBrand).not.toHaveBeenCalled();
  });

  it("an old client form shows its household's brand", async () => {
    expect(await resolveFormBrand("org_a", "c1", null, "user_c")).toBe("user_bob");
    expect(loadHouseholdBrand).toHaveBeenCalledWith("c1", "org_a");
  });

  it("an old prospect form shows its creator's brand", async () => {
    expect(await resolveFormBrand("org_a", null, null, "user_c")).toBe("user_c");
    expect(loadHouseholdBrand).not.toHaveBeenCalled();
  });
});
