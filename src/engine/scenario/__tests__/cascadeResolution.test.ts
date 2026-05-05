// src/engine/scenario/__tests__/cascadeResolution.test.ts
import { describe, it, expect } from "vitest";
import { resolveCascades } from "../cascadeResolution";
import type { ClientData, Account, Transfer, SavingsRule, BeneficiaryRef, Will } from "@/engine/types";
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
  giftEvents: [],
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

describe("resolveCascades — family_member → BeneficiaryRef", () => {
  it("drops a BeneficiaryRef whose familyMemberId was removed (engine falls back to estate)", () => {
    const t: ClientData = tree({
      accounts: [
        {
          id: "a1",
          beneficiaries: [
            { id: "b1", tier: "primary", percentage: 100, familyMemberId: "fm-removed", sortOrder: 0 } as BeneficiaryRef,
          ],
        } as unknown as Account,
      ],
    });
    const removed = [{ kind: "family_member" as TargetKind, id: "fm-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);

    const account = t.accounts[0];
    expect(account.beneficiaries).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("beneficiary_reassigned");
    expect(warnings[0].causedByChangeId).toBe("ch1");
  });

  it("preserves BeneficiaryRefs whose familyMemberId is intact", () => {
    const t: ClientData = tree({
      accounts: [
        {
          id: "a1",
          beneficiaries: [
            { id: "b1", tier: "primary", percentage: 50, familyMemberId: "fm-keep", sortOrder: 0 } as BeneficiaryRef,
            { id: "b2", tier: "primary", percentage: 50, familyMemberId: "fm-removed", sortOrder: 1 } as BeneficiaryRef,
          ],
        } as unknown as Account,
      ],
    });
    const removed = [{ kind: "family_member" as TargetKind, id: "fm-removed", causedByChangeId: "ch1" }];
    resolveCascades(t, removed);
    const benes = t.accounts[0].beneficiaries!;
    expect(benes).toHaveLength(1);
    expect(benes[0].id).toBe("b1");
  });
});

describe("resolveCascades — entity → WillBequestRecipient", () => {
  it("drops the entity recipient from a bequest and keeps remaining recipients", () => {
    const t: ClientData = tree({
      wills: [{
        id: "w1",
        grantor: "client",
        bequests: [{
          id: "bq1",
          name: "test bequest",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "entity", recipientId: "e-removed", percentage: 50, sortOrder: 0 },
            { recipientKind: "family_member", recipientId: "fm-keep", percentage: 50, sortOrder: 1 },
          ],
        }],
      } as Will],
    });
    const removed = [{ kind: "entity" as TargetKind, id: "e-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);

    const bq = t.wills![0].bequests[0];
    expect(bq.recipients).toHaveLength(1);
    expect(bq.recipients[0].recipientKind).toBe("family_member");
    expect(warnings.some((w) => w.kind === "will_bequest_dropped")).toBe(true);
  });

  it("drops the bequest entirely when its sole recipient was a removed entity", () => {
    const t: ClientData = tree({
      wills: [{
        id: "w1",
        grantor: "client",
        bequests: [{
          id: "bq1",
          name: "sole-recipient",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "entity", recipientId: "e-removed", percentage: 100, sortOrder: 0 },
          ],
        }],
      } as Will],
    });
    const removed = [{ kind: "entity" as TargetKind, id: "e-removed", causedByChangeId: "ch1" }];
    resolveCascades(t, removed);
    expect(t.wills![0].bequests).toHaveLength(0);
  });
});

describe("resolveCascades — accounts → rothConversions", () => {
  it("drops a conversion that targets a removed destination account", () => {
    const t: ClientData = tree({
      rothConversions: [
        {
          id: "rc-1",
          destinationAccountId: "a-removed",
          sourceAccountIds: ["a-trad-keep"],
        } as NonNullable<ClientData["rothConversions"]>[number],
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);
    expect(t.rothConversions).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("roth_conversion_dropped");
    expect(warnings[0].causedByChangeId).toBe("ch1");
  });

  it("drops a conversion when its only source account is removed", () => {
    const t: ClientData = tree({
      rothConversions: [
        {
          id: "rc-1",
          destinationAccountId: "a-roth",
          sourceAccountIds: ["a-only-source"],
        } as NonNullable<ClientData["rothConversions"]>[number],
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-only-source", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);
    expect(t.rothConversions).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("roth_conversion_dropped");
  });

  it("trims a removed source from the array but keeps the conversion when others remain", () => {
    const t: ClientData = tree({
      rothConversions: [
        {
          id: "rc-1",
          destinationAccountId: "a-roth",
          sourceAccountIds: ["a-removed", "a-keep"],
        } as NonNullable<ClientData["rothConversions"]>[number],
      ],
    });
    const removed = [{ kind: "account" as TargetKind, id: "a-removed", causedByChangeId: "ch1" }];
    const warnings = resolveCascades(t, removed);
    expect(t.rothConversions).toHaveLength(1);
    expect(t.rothConversions![0].sourceAccountIds).toEqual(["a-keep"]);
    expect(warnings.filter((w) => w.kind === "roth_conversion_dropped")).toEqual([]);
  });
});
