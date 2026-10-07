import { describe, it, expect } from "vitest";
import { rowToMedicareCoverage, medicareCoverageToInsert, withDefaultMedicareCoverage } from "../dbMapper";
import type { MedicareCoverage } from "@/engine/types";

const baseRow = {
  id: "r1", clientId: "c1", owner: "client" as const,
  enrollmentYear: 2025, coverageType: "original" as const,
  medigapMonthlyAt65: "170", partDPlanMonthlyAt65: "46", priorYearMagi: null,
  estimatePriorYearMagiFromProjection: false,
  createdAt: new Date(), updatedAt: new Date(),
};

describe("medicare dbMapper", () => {
  it("converts a DB row to MedicareCoverage with proper types", () => {
    const row = {
      id: "uuid-1",
      clientId: "client-1",
      owner: "client" as const,
      enrollmentYear: 2030,
      coverageType: "original" as const,
      medigapMonthlyAt65: "175.00",
      partDPlanMonthlyAt65: null,
      priorYearMagi: "245000.00",
      estimatePriorYearMagiFromProjection: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = rowToMedicareCoverage(row);
    expect(result.owner).toBe("client");
    expect(result.enrollmentYear).toBe(2030);
    expect(result.coverageType).toBe("original");
    expect(result.medigapMonthlyAt65).toBe(175);
    expect(result.partDPlanMonthlyAt65).toBeNull();
    expect(result.priorYearMagi).toBe(245000);
  });

  it("round-trips through medicareCoverageToInsert", () => {
    const coverage = {
      owner: "spouse" as const,
      enrollmentYear: null,
      coverageType: "advantage" as const,
      medigapMonthlyAt65: 0,
      partDPlanMonthlyAt65: 75,
      priorYearMagi: null,
    };
    const insert = medicareCoverageToInsert(coverage, "client-1");
    expect(insert.clientId).toBe("client-1");
    expect(insert.medigapMonthlyAt65).toBe("0");
    expect(insert.partDPlanMonthlyAt65).toBe("75");
    expect(insert.priorYearMagi).toBeNull();
  });
});

describe("dbMapper estimatePriorYearMagiFromProjection", () => {
  it("reads the flag true from the row", () => {
    const c = rowToMedicareCoverage({ ...baseRow, estimatePriorYearMagiFromProjection: true });
    expect(c.estimatePriorYearMagiFromProjection).toBe(true);
  });
  it("writes the flag into the insert, defaulting to true when undefined", () => {
    const ins = medicareCoverageToInsert(
      { owner: "client", enrollmentYear: 2025, coverageType: "original",
        medigapMonthlyAt65: 170, partDPlanMonthlyAt65: 46, priorYearMagi: null },
      "c1",
    );
    expect(ins.estimatePriorYearMagiFromProjection).toBe(true);
  });
});

describe("withDefaultMedicareCoverage", () => {
  const saved: MedicareCoverage = {
    owner: "client", enrollmentYear: 2021, coverageType: "advantage",
    medigapMonthlyAt65: 0, partDPlanMonthlyAt65: 30, priorYearMagi: 315000,
    estimatePriorYearMagiFromProjection: false,
  };

  it("models a person with no saved settings at 65 on national averages, estimating MAGI", () => {
    expect(withDefaultMedicareCoverage([], false)).toEqual([{
      owner: "client", enrollmentYear: null, coverageType: "original",
      medigapMonthlyAt65: null, partDPlanMonthlyAt65: null, priorYearMagi: null,
      estimatePriorYearMagiFromProjection: true,
    }]);
  });

  it("fills in the co-client only when there is one", () => {
    expect(withDefaultMedicareCoverage([], true).map((c) => c.owner)).toEqual(["client", "spouse"]);
  });

  it("keeps saved settings untouched, including an unchecked estimate box", () => {
    const out = withDefaultMedicareCoverage([saved], true);
    expect(out[0]).toBe(saved);
    expect(out[1]).toMatchObject({ owner: "spouse", estimatePriorYearMagiFromProjection: true });
  });
});
