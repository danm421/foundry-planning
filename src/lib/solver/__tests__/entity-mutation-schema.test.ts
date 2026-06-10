import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";

const ilit = { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true, isGrantor: false, includeInPortfolio: false, grantor: "client", trustSubType: "ilit", crummeyPowers: true };
const idgt = { id: "t2", name: "IDGT", entityType: "trust", isIrrevocable: true, isGrantor: true, includeInPortfolio: false, grantor: "spouse", trustSubType: "idgt" };

describe("SOLVER_MUTATION_SCHEMA — entity-upsert", () => {
  it("accepts an ILIT", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: ilit }).success).toBe(true);
  });
  it("accepts an IDGT", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t2", value: idgt }).success).toBe(true);
  });
  it("accepts a delete (value:null)", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: null }).success).toBe(true);
  });
  it("rejects a bad trustSubType", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: { ...ilit, trustSubType: "bogus" } }).success).toBe(false);
  });
  it("rejects a missing entityType", () => {
    const { entityType, ...noType } = ilit;
    void entityType;
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: noType }).success).toBe(false);
  });
});
