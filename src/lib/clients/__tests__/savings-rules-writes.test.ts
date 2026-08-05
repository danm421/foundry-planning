import { describe, expect, it, vi, beforeEach } from "vitest";

const setSpy = vi.fn();

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [{ id: "rule-1", accountId: "acct-1" }] }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        setSpy(patch);
        return { where: () => ({ returning: async () => [{ id: "rule-1", accountId: "acct-1" }] }) };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "rule-1", clientId: "c1" }] }) }) }),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/db-scoping", () => ({ assertAccountsInClient: async () => ({ ok: true }) }));
vi.mock("../base-case", () => ({ baseCaseScenarioId: async () => "scen-1" }));

import { updateSavingsRuleForClient } from "../savings-rules-writes";

describe("updateSavingsRuleForClient", () => {
  beforeEach(() => setSpy.mockClear());

  it("is a TRUE partial patch — omitted columns are never written", async () => {
    // The portal's savings form sends four keys. If update were a full replace,
    // this call would null employerMatchPct/contributeMax on an advisor-built
    // rule. That is the regression this test exists to catch.
    await updateSavingsRuleForClient({
      clientId: "c1",
      firmId: "f1",
      actorId: "u1",
      ruleId: "rule-1",
      input: { annualAmount: "500", startYear: 2026, endYear: 2040, accountId: "acct-1" },
    });

    const patch = setSpy.mock.calls[0][0];
    expect(patch).toHaveProperty("annualAmount", "500");
    expect(patch).not.toHaveProperty("employerMatchPct");
    expect(patch).not.toHaveProperty("contributeMax");
    expect(patch).not.toHaveProperty("annualPercent");
    expect(patch).not.toHaveProperty("rothPercent");
  });

  it("writes an explicit null when a nullable field is present-and-null", async () => {
    await updateSavingsRuleForClient({
      clientId: "c1",
      firmId: "f1",
      actorId: "u1",
      ruleId: "rule-1",
      input: { employerMatchPct: null },
    });
    expect(setSpy.mock.calls[0][0]).toHaveProperty("employerMatchPct", null);
  });
});
