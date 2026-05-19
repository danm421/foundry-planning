import { describe, it, expect } from "vitest";
import { clientCreateSchema } from "../resources";

const base = {
  firstName: "John",
  lastName: "Doe",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  lifeExpectancy: 90,
  filingStatus: "single" as const,
};

describe("clientCreateSchema — life expectancy floor", () => {
  it("accepts a sub-40 life expectancy when death is in the future", () => {
    // Born 2000, lifeExpectancy 30 -> death year 2030 (future as of 2026).
    // The old schema rejects this via min(40); the new schema must accept it.
    const result = clientCreateSchema.safeParse({
      ...base,
      dateOfBirth: "2000-01-01",
      lifeExpectancy: 30,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a life expectancy that places death in the past", () => {
    // Born 1900, lifeExpectancy 45 -> death year 1945 (past). Current schema
    // accepts it (45 >= 40); the new past-death refine must reject it.
    const result = clientCreateSchema.safeParse({
      ...base,
      dateOfBirth: "1900-01-01",
      lifeExpectancy: 45,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a spouse life expectancy that places death in the past", () => {
    // Spouse born 1900, spouseLifeExpectancy 45 -> death 1945 (past).
    const result = clientCreateSchema.safeParse({
      ...base,
      filingStatus: "married_joint",
      spouseDob: "1900-01-01",
      spouseLifeExpectancy: 45,
    });
    expect(result.success).toBe(false);
  });
});
