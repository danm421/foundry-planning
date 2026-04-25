// src/engine/scenario/__tests__/cascadeResolution.test.ts
import { describe, it, expect } from "vitest";
import { resolveCascades } from "../cascadeResolution";
import type { ClientData, Account, Transfer, SavingsRule } from "@/engine/types";
import type { TargetKind } from "../types";

const tree = (overrides: Partial<ClientData> = {}): ClientData => ({
  client: {} as ClientData["client"],
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {} as ClientData["planSettings"],
  ...overrides,
});

describe("resolveCascades — accounts → transfers", () => {
  it("drops a transfer that points at a removed source account", () => {
    const t: ClientData = tree({
      transfers: [
        { id: "tr1", sourceAccountId: "a-removed", targetAccountId: "a-keep" } as unknown as Transfer,
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);
    expect(t.transfers).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("transfer_dropped");
    expect(warnings[0].causedByChangeId).toBe("ch1");
  });

  it("drops a transfer that points at a removed destination account", () => {
    const t: ClientData = tree({
      transfers: [
        { id: "tr1", sourceAccountId: "a-keep", targetAccountId: "a-removed" } as unknown as Transfer,
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);
    expect(t.transfers).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("does not drop unrelated transfers", () => {
    const t: ClientData = tree({
      transfers: [
        { id: "tr1", sourceAccountId: "a-keep", targetAccountId: "a-other" } as unknown as Transfer,
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-removed", causedByChangeId: "ch1" }];
    resolveCascades(t, removed);
    expect(t.transfers).toHaveLength(1);
  });
});

describe("resolveCascades — accounts → savings_rules", () => {
  it("drops a savings_rule that pays from a removed account", () => {
    const t: ClientData = tree({
      savingsRules: [
        { id: "sr1", accountId: "a-removed", annualAmount: 1000 } as SavingsRule,
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);
    expect(t.savingsRules).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("savings_rule_dropped");
  });
});
