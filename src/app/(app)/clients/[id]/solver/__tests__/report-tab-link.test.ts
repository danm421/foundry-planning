import { describe, it, expect } from "vitest";
import { defaultReportForTab } from "../report-tab-link";

describe("defaultReportForTab", () => {
  it("maps life_insurance → lifeInsurance", () => {
    expect(defaultReportForTab("life_insurance")).toBe("lifeInsurance");
  });
  it("maps estate_planning → estate", () => {
    expect(defaultReportForTab("estate_planning")).toBe("estate");
  });
  it("maps retirement → portfolio", () => {
    expect(defaultReportForTab("retirement")).toBe("portfolio");
  });
  it("maps techniques → portfolio", () => {
    expect(defaultReportForTab("techniques")).toBe("portfolio");
  });
});
