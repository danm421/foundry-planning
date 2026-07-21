import { describe, it, expect } from "vitest";
import { fillAssumptions } from "../gap-fill";
import type { ImportPayload } from "@/lib/imports/types";

const empty: ImportPayload = {
  dependents: [],
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  lifePolicies: [],
  wills: [],
  entities: [],
  warnings: [],
};

describe("fillAssumptions", () => {
  it("defaults retirement age and life expectancy for a new prospect", () => {
    const r = fillAssumptions({
      payload: { ...empty, primary: { firstName: "Jane", dateOfBirth: "1975-04-02" } },
      mode: "new",
    });
    expect(r.resolved.retirementAge).toBe(65);
    expect(r.resolved.lifeExpectancy).toBe(92);
    expect(r.assumptions.map((a) => a.field)).toContain("client.retirementAge");
    expect(r.assumptions.map((a) => a.field)).toContain("client.lifeExpectancy");
  });

  it("infers married_joint filing status when a spouse is present", () => {
    const r = fillAssumptions({
      payload: {
        ...empty,
        primary: { firstName: "Jane", dateOfBirth: "1975-04-02" },
        spouse: { firstName: "John", dateOfBirth: "1974-01-01" },
      },
      mode: "new",
    });
    expect(r.resolved.filingStatus).toBe("married_joint");
    const a = r.assumptions.find((x) => x.field === "client.filingStatus");
    expect(a).toBeDefined();
    expect(a?.value).toBe("married_joint");
  });

  it("defaults filing status to single when no spouse is present", () => {
    const r = fillAssumptions({
      payload: { ...empty, primary: { firstName: "Jane", dateOfBirth: "1975-04-02" } },
      mode: "new",
    });
    expect(r.resolved.filingStatus).toBe("single");
    const a = r.assumptions.find((x) => x.field === "client.filingStatus");
    expect(a).toBeDefined();
    expect(a?.value).toBe("single");
  });

  it("translates an extracted filing status to planning vocabulary without assuming", () => {
    const r = fillAssumptions({
      payload: {
        ...empty,
        primary: {
          firstName: "Jane",
          dateOfBirth: "1975-04-02",
          filingStatus: "married_filing_jointly",
        },
        spouse: { firstName: "John", dateOfBirth: "1974-01-01" },
      },
      mode: "new",
    });
    expect(r.resolved.filingStatus).toBe("married_joint");
    expect(r.assumptions.some((a) => a.field === "client.filingStatus")).toBe(false);
  });

  it("does not re-assume known values for existing clients", () => {
    const r = fillAssumptions({
      payload: empty,
      mode: "existing",
      known: {
        retirementAge: 67,
        lifeExpectancy: 95,
        filingStatus: "single",
        primaryDob: "1970-01-01",
      },
    });
    expect(r.assumptions).toHaveLength(0);
    expect(r.resolved.retirementAge).toBe(67);
    expect(r.resolved.lifeExpectancy).toBe(95);
    expect(r.resolved.filingStatus).toBe("single");
    expect(r.resolved.primaryDob).toBe("1970-01-01");
  });

  it("does not emit an assumption for a missing primaryDob", () => {
    const r = fillAssumptions({ payload: empty, mode: "new" });
    expect(r.resolved.primaryDob).toBeUndefined();
    expect(r.assumptions.some((a) => a.field === "client.primaryDob")).toBe(false);
  });

  it("derives spouseDob from the payload without an assumption", () => {
    const r = fillAssumptions({
      payload: {
        ...empty,
        primary: { firstName: "Jane", dateOfBirth: "1975-04-02" },
        spouse: { firstName: "John", dateOfBirth: "1974-01-01" },
      },
      mode: "new",
    });
    expect(r.resolved.spouseDob).toBe("1974-01-01");
    expect(r.assumptions.some((a) => a.field === "client.spouseDob")).toBe(false);
  });
});
