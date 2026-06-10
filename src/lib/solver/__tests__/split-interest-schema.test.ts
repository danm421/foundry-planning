import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";

const SNAPSHOT = {
  inceptionYear: 2030,
  inceptionValue: 1_000_000,
  payoutType: "unitrust",
  payoutPercent: 0.05,
  payoutAmount: null,
  irc7520Rate: 0.04,
  termType: "years",
  termYears: 20,
  measuringLife1Id: null,
  measuringLife2Id: null,
  charityId: "char-1",
  originalIncomeInterest: 320_000,
  originalRemainderInterest: 680_000,
};

const crt = {
  id: "t1",
  name: "CRT",
  entityType: "trust",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  grantor: "client",
  trustSubType: "crt",
  splitInterest: SNAPSHOT,
};

const clt = {
  id: "t2",
  name: "CLT",
  entityType: "trust",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  grantor: "client",
  trustSubType: "clt",
  splitInterest: {
    ...SNAPSHOT,
    payoutType: "annuity",
    payoutPercent: null,
    payoutAmount: 50_000,
  },
};

describe("SOLVER_MUTATION_SCHEMA — entity-upsert splitInterest snapshot", () => {
  it("accepts a CRT entity with a valid unitrust splitInterest snapshot", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: crt }).success,
    ).toBe(true);
  });

  it("accepts a CLT entity with annuity payout splitInterest snapshot", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t2", value: clt }).success,
    ).toBe(true);
  });

  it("accepts entity without splitInterest (optional field)", () => {
    const { splitInterest: _, ...crtNoSnapshot } = crt;
    void _;
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value: crtNoSnapshot })
        .success,
    ).toBe(true);
  });

  it("rejects a splitInterest snapshot with bad payoutType", () => {
    const value = { ...crt, splitInterest: { ...SNAPSHOT, payoutType: "bogus" } };
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value }).success,
    ).toBe(false);
  });

  it("rejects a splitInterest snapshot with bad termType", () => {
    const value = { ...crt, splitInterest: { ...SNAPSHOT, termType: "forever" } };
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value }).success,
    ).toBe(false);
  });

  it("rejects a splitInterest snapshot with negative inceptionValue", () => {
    const value = { ...crt, splitInterest: { ...SNAPSHOT, inceptionValue: -5 } };
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "entity-upsert", id: "t1", value }).success,
    ).toBe(false);
  });
});
