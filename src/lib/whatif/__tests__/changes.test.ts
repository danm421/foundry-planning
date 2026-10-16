import { describe, it, expect } from "vitest";
import {
  WHAT_IF_CHANGE_SCHEMA,
  WHAT_IF_CHANGE_TYPES,
  SOLVE_FOR_SCHEMA,
} from "../changes";
import { changeError, WhatIfValidationError } from "../errors";

describe("WHAT_IF_CHANGE_SCHEMA", () => {
  it("accepts a retirement age change", () => {
    expect(WHAT_IF_CHANGE_SCHEMA.parse({ type: "retirement_age", person: "client", age: 62 })).toEqual({
      type: "retirement_age",
      person: "client",
      age: 62,
    });
  });

  it("rejects an unknown change type", () => {
    expect(WHAT_IF_CHANGE_SCHEMA.safeParse({ type: "buy_a_boat" }).success).toBe(false);
  });

  it("drops a smuggled key", () => {
    const parsed = WHAT_IF_CHANGE_SCHEMA.parse({ type: "spending_scale", multiplier: 0.9, firmId: "org_x" });
    expect(parsed).not.toHaveProperty("firmId");
  });

  it("rejects a relocation to a state code that does not exist", () => {
    expect(WHAT_IF_CHANGE_SCHEMA.safeParse({ type: "relocation", year: 2030, state: "ZZ" }).success).toBe(false);
    expect(WHAT_IF_CHANGE_SCHEMA.safeParse({ type: "relocation", year: 2030, state: "FL" }).success).toBe(true);
  });

  it("accepts a bracket-fill Roth conversion", () => {
    const parsed = WHAT_IF_CHANGE_SCHEMA.parse({
      type: "roth_conversion",
      fromAccountIds: ["a"],
      toAccountId: "b",
      mode: "fill_bracket",
      bracket: 0.24,
      startYear: 2027,
      endYear: 2032,
    });
    expect(parsed.type).toBe("roth_conversion");
  });

  it("rejects a retirement age outside 40–85", () => {
    expect(WHAT_IF_CHANGE_SCHEMA.safeParse({ type: "retirement_age", person: "client", age: 30 }).success).toBe(false);
  });

  it("lists 34 change types, each once", () => {
    expect(WHAT_IF_CHANGE_TYPES).toHaveLength(34);
    expect(new Set(WHAT_IF_CHANGE_TYPES).size).toBe(34);
  });
});

describe("SOLVE_FOR_SCHEMA", () => {
  it("accepts a max-spending solve at 85%", () => {
    expect(SOLVE_FOR_SCHEMA.parse({ kind: "max_spending", targetSuccess: 0.85 })).toEqual({
      kind: "max_spending",
      targetSuccess: 0.85,
    });
  });

  it("rejects a 100% target", () => {
    expect(SOLVE_FOR_SCHEMA.safeParse({ kind: "max_spending", targetSuccess: 1 }).success).toBe(false);
  });

  it("needs no target for the Social Security claim-age solve", () => {
    expect(SOLVE_FOR_SCHEMA.safeParse({ kind: "ss_claim_age", person: "spouse" }).success).toBe(true);
  });
});

describe("changeError", () => {
  it("numbers changes from 1, the way the model wrote the list", () => {
    const err = changeError(2, "account x isn't in this plan.");
    expect(err).toBeInstanceOf(WhatIfValidationError);
    expect(err.message).toBe("Change 3: account x isn't in this plan.");
  });
});
