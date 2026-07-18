/**
 * Audit F13 — a solver-created entity must get a checking account, mirroring
 * the API path at src/app/api/clients/[id]/entities/route.ts:236-260.
 *
 * Without it, entityCheckingByEntityId (projection.ts:557-563) has no entry and
 * every trust payment pass silently `continue`s — a CRT/CLT in a scenario the
 * advisor is actively steering makes ZERO payments with no error.
 */
import { describe, it, expect } from "vitest";
import { applyMutations } from "../apply-mutations";
import { isFullyEntityOwned } from "@/engine/ownership";
import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "../types";

const TRUST_ID = "00000000-0000-0000-0000-0000000007a1";

function baseData(): ClientData {
  return {
    client: {
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
      filingStatus: "single",
      state: "PA",
      familyMembers: [],
    },
    accounts: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    entities: [],
    withdrawalStrategy: [],
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2030,
      inflationRate: 0,
      taxMode: "flat",
      flatTaxRate: 0,
    },
  } as unknown as ClientData;
}

const upsertTrust: SolverMutation = {
  kind: "entity-upsert",
  id: TRUST_ID,
  value: {
    id: TRUST_ID,
    name: "Scenario CRT",
    includeInPortfolio: false,
    isGrantor: false,
    isIrrevocable: true,
    entityType: "trust",
    trustSubType: "crt",
  },
} as unknown as SolverMutation;

describe("F13 — entity-upsert creates an entity checking account", () => {
  it("synthesizes a default-checking account owned 100% by the entity", () => {
    const result = applyMutations(baseData(), [upsertTrust]);
    const checking = result.accounts.find((a) => a.id === `entity-checking-${TRUST_ID}`);

    expect(checking).toBeDefined();
    expect(checking!.isDefaultChecking).toBe(true);
    expect(checking!.category).toBe("cash");
    expect(checking!.subType).toBe("checking");
    expect(checking!.value).toBe(0);
    // Must satisfy the engine predicate at projection.ts:557-563.
    expect(isFullyEntityOwned(checking!)).toBe(true);
    expect(checking!.owners).toEqual([
      { kind: "entity", entityId: TRUST_ID, percent: 1 },
    ]);
  });

  it("is idempotent — re-applying does not stack duplicates", () => {
    const result = applyMutations(baseData(), [upsertTrust, upsertTrust]);
    const matches = result.accounts.filter(
      (a) => a.id === `entity-checking-${TRUST_ID}`,
    );
    expect(matches).toHaveLength(1);
  });

  it("does not create a second account when the entity already has one", () => {
    const data = baseData();
    data.accounts.push({
      id: "pre-existing-trust-cash",
      name: "Existing Trust Cash",
      category: "cash",
      subType: "checking",
      value: 250_000,
      basis: 250_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    } as unknown as ClientData["accounts"][number]);

    const result = applyMutations(data, [upsertTrust]);
    const entityCash = result.accounts.filter(
      (a) => a.isDefaultChecking && a.owners.some(
        (o) => o.kind === "entity" && o.entityId === TRUST_ID,
      ),
    );
    expect(entityCash).toHaveLength(1);
    expect(entityCash[0].id).toBe("pre-existing-trust-cash");
  });

  it("removes nothing when the upsert deletes the entity (value null)", () => {
    const result = applyMutations(baseData(), [
      upsertTrust,
      { kind: "entity-upsert", id: TRUST_ID, value: null } as unknown as SolverMutation,
    ]);
    expect(result.entities).toHaveLength(0);
  });
});
