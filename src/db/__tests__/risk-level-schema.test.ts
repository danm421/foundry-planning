import { describe, expect, it } from "vitest";
import { riskLevelEnum, modelPortfolios, clients } from "@/db/schema";
import { RISK_LEVELS } from "@/lib/risk-levels";

describe("risk_level schema", () => {
  it("pgEnum matches the shared RISK_LEVELS tuple", () => {
    expect(riskLevelEnum.enumValues).toEqual([...RISK_LEVELS]);
  });

  it("exposes the two nullable columns", () => {
    expect(modelPortfolios.riskLevel).toBeDefined();
    expect(clients.riskTolerance).toBeDefined();
  });
});
