import { describe, it, expect } from "vitest";
import {
  clientRiskProfiles,
  clientRiskProfileEvents,
  riskQuestionnaires,
  scenarioComputeCache,
} from "@/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  PURGED_FIRM_TABLES,
  CASCADE_COVERED_FIRM_TABLES,
} from "@/lib/billing/purge-coverage";

describe("risk profile schema", () => {
  it("names the three tables as the plan expects", () => {
    expect(getTableConfig(clientRiskProfiles).name).toBe("client_risk_profiles");
    expect(getTableConfig(clientRiskProfileEvents).name).toBe("client_risk_profile_events");
    expect(getTableConfig(riskQuestionnaires).name).toBe("risk_questionnaires");
  });

  it("holds one profile per client", () => {
    const cfg = getTableConfig(clientRiskProfiles);
    const unique = cfg.uniqueConstraints.concat(
      cfg.indexes.filter((i) => i.config.unique) as never[],
    );
    expect(unique.length).toBeGreaterThan(0);
  });

  // A new firm_id table that nobody assigns a purge fate leaves customer data
  // behind after a firm is purged. purge-coverage.test.ts asserts this against
  // the live schema; assert it here too so the failure names the risk tables.
  it("assigns every new firm-scoped table a purge fate", () => {
    for (const t of [
      "client_risk_profiles",
      "client_risk_profile_events",
      "risk_questionnaires",
    ]) {
      const covered =
        PURGED_FIRM_TABLES.includes(t) || CASCADE_COVERED_FIRM_TABLES.includes(t);
      expect(covered, `${t} has no purge fate`).toBe(true);
    }
  });

  it("allows risk_capacity as a compute-cache kind", () => {
    const kind = getTableConfig(scenarioComputeCache).columns.find(
      (c) => c.name === "kind",
    );
    expect(kind?.enumValues).toContain("risk_capacity");
  });
});
