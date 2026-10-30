import { describe, it, expect } from "vitest";
import {
  monthlyCashFlowOptionsSchema,
  summarizeMonthlyCashFlowOptions,
  estimateMonthlyCashFlowPageCount,
} from "../options-schema";
import { MONTHLY_CASH_FLOW_OPTIONS_DEFAULT } from "../types";

describe("monthlyCashFlowOptionsSchema", () => {
  it("parses a descriptor saved before the Distributions option to mode cashflow, other fields unchanged", () => {
    const saved = { view: "months", basis: "nominal", range: { startYear: 2041, endYear: 2050 }, year: 2044 };
    expect(monthlyCashFlowOptionsSchema.parse(saved)).toEqual({ ...saved, mode: "cashflow" });
  });

  it("defaults to the Cash flow report", () => {
    expect(MONTHLY_CASH_FLOW_OPTIONS_DEFAULT.mode).toBe("cashflow");
  });

  it("summarises Distributions with the year rule and basis", () => {
    const d = { ...MONTHLY_CASH_FLOW_OPTIONS_DEFAULT, mode: "distributions" as const };
    expect(summarizeMonthlyCashFlowOptions(d)).toBe("Distributions · first shortfall year · Today's dollars");
    expect(summarizeMonthlyCashFlowOptions({ ...d, year: 2044, basis: "nominal" })).toBe(
      "Distributions · 2044 · Future dollars",
    );
  });

  it("keeps Cash flow at one page", () => {
    expect(estimateMonthlyCashFlowPageCount(undefined, MONTHLY_CASH_FLOW_OPTIONS_DEFAULT)).toBe(1);
  });
});
