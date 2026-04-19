import { describe, it, expect } from "vitest";
import { detectIncomeEvents } from "../../detectors/income";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectIncomeEvents", () => {
  it("emits salary start and stop per salary income", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);

    const johnStart = events.find((e) => e.id === "income:salary_start:primary:inc-salary-john");
    const johnStop = events.find((e) => e.id === "income:salary_stop:primary:inc-salary-john");
    expect(johnStart?.year).toBe(2026);
    expect(johnStop?.year).toBe(2035);

    const janeStart = events.find((e) => e.id === "income:salary_start:spouse:inc-salary-jane");
    const janeStop = events.find((e) => e.id === "income:salary_stop:spouse:inc-salary-jane");
    expect(janeStart?.year).toBe(2026);
    expect(janeStop?.year).toBe(2037);
  });

  it("emits social_security begin with correct supporting figure", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    const ss = events.find((e) => e.id === "income:ss_begin:primary:inc-ss-john");
    expect(ss).toBeDefined();
    expect(ss!.year).toBe(2026);
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

  it("emits pension start for income type=pension", () => {
    const data = buildClientData();
    data.incomes = [
      ...data.incomes,
      {
        id: "inc-pension-john",
        type: "pension",
        name: "John Pension",
        annualAmount: 18_000,
        startYear: 2040,
        endYear: 2055,
        growthRate: 0.02,
        owner: "client",
      },
    ];
    const projection = runProjection(data);
    const events = detectIncomeEvents(data, projection);
    const pen = events.find((e) => e.id === "income:pension_start:primary:inc-pension-john");
    expect(pen).toBeDefined();
    expect(pen!.year).toBe(2040);
  });
});
