import { describe, it, expect } from "vitest";
import { detectIncomeEvents } from "../../detectors/income";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectIncomeEvents", () => {
  it("suppresses salary start at the plan's first year but still emits stop", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);

    // Both fixture salaries start in 2026 (the plan's first year). Such incomes
    // have typically been running for years before the plan, so the "begins"
    // milestone is suppressed; the "ends" milestone is unaffected.
    expect(events.find((e) => e.id === "income:salary_start:primary:inc-salary-john")).toBeUndefined();
    expect(events.find((e) => e.id === "income:salary_start:spouse:inc-salary-jane")).toBeUndefined();

    const johnStop = events.find((e) => e.id === "income:salary_stop:primary:inc-salary-john");
    const janeStop = events.find((e) => e.id === "income:salary_stop:spouse:inc-salary-jane");
    expect(johnStop?.year).toBe(2035);
    expect(janeStop?.year).toBe(2037);
  });

  it("emits salary start for a salary that begins after the plan's first year", () => {
    const data = buildClientData();
    data.incomes = [
      {
        id: "inc-future",
        type: "salary",
        name: "New Job",
        annualAmount: 80_000,
        startYear: 2030, // after plan start 2026
        endYear: 2040,
        growthRate: 0,
        owner: "client",
      },
    ];
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    const start = events.find((e) => e.id === "income:salary_start:primary:inc-future");
    expect(start?.year).toBe(2030);
  });

  it("emits social_security begin with correct supporting figure", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    const ss = events.find((e) => e.id === "income:ss_begin:primary:inc-ss-john");
    expect(ss).toBeDefined();
    expect(ss!.year).toBe(2026);
    expect(ss!.supportingFigure).toBe("$36,000/yr SS");
  });

  it("skips income start/stop outside the projection window", () => {
    const data = buildClientData();
    data.incomes = [
      {
        id: "inc-late",
        type: "salary",
        name: "Late",
        annualAmount: 100_000,
        startYear: 2060, // after plan end 2055
        endYear: 2070,
        growthRate: 0,
        owner: "client",
      },
    ];
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    expect(events.find((e) => e.id.startsWith("income:salary_start:primary:inc-late"))).toBeUndefined();
  });
});
