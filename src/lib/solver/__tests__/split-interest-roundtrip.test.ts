// src/lib/solver/__tests__/split-interest-roundtrip.test.ts
//
// Persistence round-trip: a solver-created CRT/CLT scenario must survive the
// full save → reload path:
//   1. mutationsToScenarioChanges() emits structured drafts (add/edit).
//   2. Ordering: entity draft orderIndex < account draft (and < gift draft for CLT).
//   3. applyScenarioChanges() replays onto the base tree:
//      - entity (with splitInterest snapshot) appears in effectiveTree.entities
//      - external-beneficiary (charity) appears in effectiveTree.externalBeneficiaries
//      - CLT remainder gift appears in effectiveTree.gifts with correct recipient
//      - funded account's owners → [{kind:"entity",entityId,percent:1}]
//
// This is the safety net for the split-interest (CRT/CLT) lever (estate phase 3b).

import { describe, it, expect } from "vitest";
import type { Account, ClientData } from "@/engine/types";
import type { TargetKind, ScenarioChange } from "@/engine/scenario/types";
import type { SolverMutation } from "../types";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import {
  buildSplitInterestSnapshot,
  buildSplitInterestTrustEntity,
  buildCltRemainderGiftMutation,
} from "../split-interest-levers";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";

// ── Shared fixture helpers ────────────────────────────────────────────────────

function tree(): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [
      {
        id: "acct-1",
        name: "Brokerage",
        category: "taxable",
        value: 500_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      },
    ],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    entities: [],
    externalBeneficiaries: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    familyMembers: [
      { id: "fm-client", role: "client", firstName: "Pat", dateOfBirth: "1960-01-01" },
    ],
  } as unknown as ClientData;
}

/** Map SolverScenarioChangeDraft[] → ScenarioChange[]: mirrors the 3a pattern exactly. */
function toChanges(drafts: ReturnType<typeof mutationsToScenarioChanges>): ScenarioChange[] {
  return drafts.map((d, i) => ({
    id: `c${i}`,
    scenarioId: "s1",
    opType: d.opType,
    // SolverScenarioChangeDraft.targetKind is a superset of TargetKind;
    // "entity", "account", "gift", "external_beneficiary" are all valid — cast documents this.
    targetKind: d.targetKind as TargetKind,
    targetId: d.targetId,
    payload: d.payload,
    toggleGroupId: null,
    orderIndex: d.orderIndex,
  }));
}

// ── Shared input data ─────────────────────────────────────────────────────────

const CHARITY_ID = "550e8400-e29b-41d4-a716-446655440001";
const PLAN_YEAR = 2026;

// Shared split-interest form input: termType "years" avoids measuring-life ages.
function makeSplitInterestInput(inceptionValue: number): TrustSplitInterestInput {
  return {
    inceptionYear: PLAN_YEAR,
    inceptionValue,
    payoutType: "unitrust",
    payoutPercent: 0.05,
    irc7520Rate: 0.045,
    termType: "years",
    termYears: 10,
    charityId: CHARITY_ID,
  };
}

// ── CRT round-trip ────────────────────────────────────────────────────────────

describe("CRT scenario round-trip (save → reload)", () => {
  it("entity+splitInterest, charity, and funded account survive replay, entity before account", () => {
    const base = tree();

    const crtEntityId = "crt-entity-1";
    const input = makeSplitInterestInput(500_000);
    const snapshot = buildSplitInterestSnapshot(input, "crt", { age1: undefined, age2: undefined });
    const crtEntity = buildSplitInterestTrustEntity({
      id: crtEntityId,
      name: "My CRT",
      subType: "crt",
      grantor: "client",
      splitInterest: snapshot,
    });

    const retitledAccount: Account = {
      ...(base.accounts[0] as Account),
      owners: [{ kind: "entity", entityId: crtEntityId, percent: 1 }],
    };

    const muts: SolverMutation[] = [
      {
        kind: "external-beneficiary-upsert",
        id: CHARITY_ID,
        value: { id: CHARITY_ID, name: "American Red Cross", kind: "charity", charityType: "public" },
      },
      { kind: "entity-upsert", id: crtEntityId, value: crtEntity },
      { kind: "account-upsert", id: "acct-1", value: retitledAccount },
    ];

    // ── Save: mutations → structured scenario-change drafts ──────────────────
    const drafts = mutationsToScenarioChanges(base, "client-1", muts);

    const charityDraft = drafts.find((d) => d.targetId === CHARITY_ID);
    const entityDraft = drafts.find((d) => d.targetId === crtEntityId);
    const acctDraft = drafts.find((d) => d.targetId === "acct-1");

    // 1. Charity and entity are ADDs (not in base).
    expect(charityDraft?.opType).toBe("add");
    expect(charityDraft?.targetKind).toBe("external_beneficiary");
    expect(entityDraft?.opType).toBe("add");
    expect(entityDraft?.targetKind).toBe("entity");

    // 2. Account is an EDIT (acct-1 exists in base tree).
    expect(acctDraft?.opType).toBe("edit");
    expect(acctDraft?.targetKind).toBe("account");

    // 3. Ordering: entity add before account edit.
    expect(entityDraft!.orderIndex).toBeLessThan(acctDraft!.orderIndex);

    // ── Load/replay: structured changes → effective tree ─────────────────────
    const { effectiveTree } = applyScenarioChanges(
      structuredClone(base),
      toChanges(drafts),
      {},  // no toggle overrides — all changes are ungrouped (always active)
      [],  // no toggle groups
    );

    // 4. Charity persisted.
    expect(effectiveTree.externalBeneficiaries?.some((b) => b.id === CHARITY_ID)).toBe(true);

    // 5. The CRT entity is present with intact splitInterest snapshot.
    const entity = effectiveTree.entities?.find((e) => e.id === crtEntityId);
    expect(entity).toBeDefined();
    expect(entity?.trustSubType).toBe("crt");
    expect(entity?.splitInterest).toBeDefined();
    const si = entity!.splitInterest!;
    expect(si.charityId).toBe(CHARITY_ID);
    expect(si.payoutType).toBe(snapshot.payoutType);
    expect(si.termYears).toBe(snapshot.termYears);
    expect(si.originalIncomeInterest).toBe(snapshot.originalIncomeInterest);
    expect(si.originalRemainderInterest).toBe(snapshot.originalRemainderInterest);

    // 6. The funded account's owners reflect entity ownership (not original family_member).
    const acct = effectiveTree.accounts.find((a) => a.id === "acct-1")!;
    expect(acct.owners).toEqual([{ kind: "entity", entityId: crtEntityId, percent: 1 }]);
  });
});

// ── CLT round-trip ────────────────────────────────────────────────────────────

describe("CLT scenario round-trip (save → reload)", () => {
  it("entity+splitInterest, charity, remainder gift, and funded account survive replay; ordering preserved", () => {
    const base = tree();

    const cltEntityId = "clt-entity-1";
    const giftId = "clt-gift-1";
    const input = makeSplitInterestInput(500_000);
    const snapshot = buildSplitInterestSnapshot(input, "clt", { age1: undefined, age2: undefined });
    const cltEntity = buildSplitInterestTrustEntity({
      id: cltEntityId,
      name: "My CLT",
      subType: "clt",
      grantor: "client",
      splitInterest: snapshot,
    });
    const giftMut = buildCltRemainderGiftMutation(cltEntityId, snapshot, "client", giftId);

    const retitledAccount: Account = {
      ...(base.accounts[0] as Account),
      owners: [{ kind: "entity", entityId: cltEntityId, percent: 1 }],
    };

    const muts: SolverMutation[] = [
      {
        kind: "external-beneficiary-upsert",
        id: CHARITY_ID,
        value: { id: CHARITY_ID, name: "American Red Cross", kind: "charity", charityType: "public" },
      },
      { kind: "entity-upsert", id: cltEntityId, value: cltEntity },
      giftMut,
      { kind: "account-upsert", id: "acct-1", value: retitledAccount },
    ];

    // ── Save: mutations → structured scenario-change drafts ──────────────────
    const drafts = mutationsToScenarioChanges(base, "client-1", muts);

    const charityDraft = drafts.find((d) => d.targetId === CHARITY_ID);
    const entityDraft = drafts.find((d) => d.targetId === cltEntityId);
    const giftDraft = drafts.find((d) => d.targetId === giftId);
    const acctDraft = drafts.find((d) => d.targetId === "acct-1");

    // 1. Types.
    expect(charityDraft?.opType).toBe("add");
    expect(charityDraft?.targetKind).toBe("external_beneficiary");
    expect(entityDraft?.opType).toBe("add");
    expect(entityDraft?.targetKind).toBe("entity");
    expect(giftDraft?.opType).toBe("add");
    expect(giftDraft?.targetKind).toBe("gift");
    expect(acctDraft?.opType).toBe("edit");
    expect(acctDraft?.targetKind).toBe("account");

    // 2. Ordering: entity before account AND entity before gift.
    expect(entityDraft!.orderIndex).toBeLessThan(acctDraft!.orderIndex);
    expect(entityDraft!.orderIndex).toBeLessThan(giftDraft!.orderIndex);

    // ── Load/replay: structured changes → effective tree ─────────────────────
    const { effectiveTree } = applyScenarioChanges(
      structuredClone(base),
      toChanges(drafts),
      {},
      [],
    );

    // 3. Charity persisted.
    expect(effectiveTree.externalBeneficiaries?.some((b) => b.id === CHARITY_ID)).toBe(true);

    // 4. The CLT entity is present with intact splitInterest snapshot.
    const entity = effectiveTree.entities?.find((e) => e.id === cltEntityId);
    expect(entity).toBeDefined();
    expect(entity?.trustSubType).toBe("clt");
    expect(entity?.splitInterest).toBeDefined();
    const si = entity!.splitInterest!;
    expect(si.charityId).toBe(CHARITY_ID);
    expect(si.payoutType).toBe(snapshot.payoutType);
    expect(si.termYears).toBe(snapshot.termYears);
    expect(si.originalIncomeInterest).toBe(snapshot.originalIncomeInterest);
    expect(si.originalRemainderInterest).toBe(snapshot.originalRemainderInterest);

    // 5. The CLT remainder gift survived reload. The add-path stores the raw
    // EstateFlowGift payload (nested recipient + eventKind), not the flat Gift
    // shape, so read it through that runtime shape.
    const gift = effectiveTree.gifts?.find((g) => g.id === giftId) as
      | { recipient?: { id?: string }; eventKind?: string }
      | undefined;
    expect(gift).toBeDefined();
    expect(gift?.recipient?.id).toBe(cltEntityId);
    expect(gift?.eventKind).toBe("clt_remainder_interest");

    // 6. The funded account's owners reflect entity ownership.
    const acct = effectiveTree.accounts.find((a) => a.id === "acct-1")!;
    expect(acct.owners).toEqual([{ kind: "entity", entityId: cltEntityId, percent: 1 }]);
  });
});
