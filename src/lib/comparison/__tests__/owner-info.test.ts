import { describe, it, expect } from "vitest";
import { deriveOwnerNames, deriveOwnerDobs } from "../owner-info";
import type { ClientData } from "@/engine/types";

const baseClient = (overrides: Partial<ClientData["client"]> = {}) => ({
  firstName: "Alex",
  lastName: "Park",
  dateOfBirth: "1965-04-10",
  retirementAge: 67,
  planEndAge: 95,
  filingStatus: "single" as const,
  ...overrides,
});

describe("deriveOwnerNames", () => {
  it("returns clientName from firstName and null spouseName when unmarried", () => {
    const out = deriveOwnerNames({ client: baseClient() } as ClientData);
    expect(out).toEqual({ clientName: "Alex", spouseName: null });
  });

  it("returns spouseName from spouseName field when married", () => {
    const out = deriveOwnerNames({
      client: baseClient({
        filingStatus: "married_joint",
        spouseName: "Riley",
        spouseDob: "1967-01-01",
      }),
    } as ClientData);
    expect(out).toEqual({ clientName: "Alex", spouseName: "Riley" });
  });

  it("falls back to 'Spouse' when married but no spouseName provided", () => {
    const out = deriveOwnerNames({
      client: baseClient({ filingStatus: "married_joint", spouseDob: "1967-01-01" }),
    } as ClientData);
    expect(out).toEqual({ clientName: "Alex", spouseName: "Spouse" });
  });
});

describe("deriveOwnerDobs", () => {
  it("returns spouseDob: null when unmarried", () => {
    const out = deriveOwnerDobs({ client: baseClient() } as ClientData);
    expect(out).toEqual({ clientDob: "1965-04-10", spouseDob: null });
  });

  it("returns spouseDob when present", () => {
    const out = deriveOwnerDobs({
      client: baseClient({ spouseDob: "1967-01-01" }),
    } as ClientData);
    expect(out).toEqual({ clientDob: "1965-04-10", spouseDob: "1967-01-01" });
  });
});
