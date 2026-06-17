import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/base-case", () => ({ baseCaseScenarioId: vi.fn() }));

import { requireOrgId } from "@/lib/db-helpers";
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import { resolveBaseScenarioId } from "../actions";

describe("resolveBaseScenarioId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the base scenario id scoped to the caller's firm", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("firm_1");
    vi.mocked(baseCaseScenarioId).mockResolvedValue("scn_base");

    const id = await resolveBaseScenarioId("client_1");

    expect(id).toBe("scn_base");
    expect(baseCaseScenarioId).toHaveBeenCalledWith("client_1", "firm_1");
  });

  it("returns null when the client has no base case / is inaccessible", async () => {
    vi.mocked(requireOrgId).mockResolvedValue("firm_1");
    vi.mocked(baseCaseScenarioId).mockResolvedValue(null);

    expect(await resolveBaseScenarioId("client_x")).toBeNull();
  });
});
