import { describe, it, expect } from "vitest";
import { detectLifeEvents } from "../../detectors/life";
import { runProjection } from "@foundry/engine";
import { buildClientData, baseClient } from "@foundry/engine/__tests__/fixtures";

describe("detectLifeEvents", () => {
  it("emits primary retirement at retirementAge", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const retire = events.find((e) => e.id === "life:retire:primary");
    expect(retire).toBeDefined();
    // John born 1970, retirementAge 65 → year 2035
    expect(retire!.year).toBe(2035);
    expect(retire!.age).toBe(65);
    expect(retire!.subject).toBe("primary");
  });

  it("emits spouse retirement at spouseRetirementAge", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const retire = events.find((e) => e.id === "life:retire:spouse");
    expect(retire).toBeDefined();
    // Jane born 1972, spouseRetirementAge 65 → year 2037
    expect(retire!.year).toBe(2037);
    expect(retire!.age).toBe(65);
  });

  it("emits Medicare eligibility at age 65 for primary", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const medi = events.find((e) => e.id === "life:medicare:primary");
    expect(medi).toBeDefined();
    expect(medi!.year).toBe(2035);
    expect(medi!.age).toBe(65);
  });

  it("emits SS FRA at age 67 for primary", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const fra = events.find((e) => e.id === "life:ss_fra:primary");
    expect(fra).toBeDefined();
    expect(fra!.year).toBe(2037);
    expect(fra!.age).toBe(67);
  });

  it("emits SS claim when claimingAge is set on a social_security income", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const ssClaim = events.find((e) => e.id === "life:ss_claim:primary");
    expect(ssClaim).toBeDefined();
    expect(ssClaim!.age).toBe(67); // fixture sets John SS claimingAge=67
  });

  it("emits death in the final projection year when life expectancy hits", () => {
    const data = buildClientData({
      client: { ...baseClient, lifeExpectancy: 85 }, // John born 1970 → dies 2055 (end of plan)
    });
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    const death = events.find((e) => e.id === "life:death:primary");
    expect(death).toBeDefined();
    expect(death!.year).toBe(2055);
  });

  it("produces only primary events when client is single (no spouseName)", () => {
    const data = buildClientData({
      client: {
        ...baseClient,
        spouseName: undefined,
        spouseDob: undefined,
        spouseRetirementAge: undefined,
        spouseLifeExpectancy: null,
        filingStatus: "single",
      },
    });
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    expect(events.every((e) => e.subject !== "spouse")).toBe(true);
  });

  it("omits life events that fall outside the projection window", () => {
    // If retirementAge is 90 but plan ends at age 85, no retirement event should be emitted.
    const data = buildClientData({
      client: { ...baseClient, retirementAge: 90, planEndAge: 85 },
    });
    const projection = runProjection(data);
    const events = detectLifeEvents(data, projection);
    expect(events.find((e) => e.id === "life:retire:primary")).toBeUndefined();
  });
});
