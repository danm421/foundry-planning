import { describe, it, expect } from "vitest";
import type { Account, ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import {
  applyKindPreset,
  guidedTrustContext,
  initialAnswers,
  type FundingItem,
} from "../guided-trust";
import { buildGuidedTrustBatch } from "../guided-trust-batch";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { resolveToggleGroups } from "../save-scenario";
import { trustSetupGroups } from "../trust-setup-groups";
import type { SolverScenarioChangeDraft } from "../types";

const E = "trust-new";
const NAME = "Sam Rivera Irrevocable Trust";

function tree(): ClientData {
  return {
    client: {
      firstName: "Alex", lastName: "Rivera", dateOfBirth: "1970-05-01",
      spouseName: "Jordan", spouseDob: "1972-03-02",
    },
    accounts: [
      {
        id: "acct-brk", name: "Joint Brokerage", category: "taxable", value: 400_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      },
    ] as unknown as Account[],
    planSettings: { planStartYear: 2026 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Alex", lastName: "Rivera" },
      { id: "fm-s", role: "spouse", relationship: "other", firstName: "Jordan", lastName: "Rivera" },
      { id: "fm-kid", role: "child", relationship: "child", firstName: "Sam", lastName: "Rivera" },
    ],
    externalBeneficiaries: [],
    entities: [],
    wills: [],
  } as unknown as ClientData;
}

const kid = { person: { kind: "family_member" as const, id: "fm-kid" }, percentage: 100 };
const cashGift: EstateFlowGift = {
  kind: "cash-once", id: "g-cash", year: 2026, amount: 1_000_000, grantor: "client",
  recipient: { kind: "entity", id: E }, crummey: true, eventKind: "outright",
  valuationDiscount: 0,
};

function batchDrafts(funding: FundingItem[]): SolverScenarioChangeDraft[] {
  const t = tree();
  const a = applyKindPreset(
    { ...initialAnswers(E), lifetime: [kid], remainder: [kid], name: NAME, funding },
    "irrevocable",
    guidedTrustContext(t, {}),
  );
  let n = 0;
  const batch = buildGuidedTrustBatch(a, t, () => `id-${++n}`);
  return mutationsToScenarioChanges(t, "c1", batch.mutations);
}

const draft = (
  opType: SolverScenarioChangeDraft["opType"],
  targetKind: SolverScenarioChangeDraft["targetKind"],
  targetId: string,
  payload: unknown,
): SolverScenarioChangeDraft =>
  ({ opType, targetKind, targetId, payload, orderIndex: 0 }) as SolverScenarioChangeDraft;

const trustAdd = (extra: Record<string, unknown> = {}) =>
  draft("add", "entity", E, { id: E, name: NAME, entityType: "trust", ...extra });

describe("trustSetupGroups", () => {
  it("groups a wizard batch's trust, gift and retitled account under one switch", () => {
    const drafts = batchDrafts([
      { kind: "gift", gift: cashGift },
      { kind: "retitle", accountId: "acct-brk" },
    ]);
    const groups = trustSetupGroups(drafts);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe(`Set up ${NAME}`);
    expect([...groups[0].targetIds].sort()).toEqual([E, "acct-brk", "g-cash"].sort());
  });

  it("includes a will edit that names the trust (diff .to) and a bequest add", () => {
    const groups = trustSetupGroups([
      trustAdd(),
      draft("edit", "will", "w1", {
        bequests: { from: [], to: [{ id: "b1", recipients: [{ recipientKind: "entity", recipientId: E }] }] },
      }),
      draft("add", "will", "w2", {
        residuaryRecipients: [{ recipientKind: "entity", recipientId: E }],
      }),
      draft("edit", "will", "w3", {
        bequests: { from: [], to: [{ recipients: [{ recipientKind: "family_member", recipientId: "fm-kid" }] }] },
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].targetIds).toEqual([E, "w1", "w2"]);
  });

  it("includes accounts owned via gifted_away or naming the trust as a beneficiary", () => {
    const groups = trustSetupGroups([
      trustAdd(),
      draft("edit", "account", "a1", {
        owners: { from: [], to: [{ kind: "gifted_away", recipient: { kind: "entity", id: E }, percent: 1 }] },
      }),
      draft("add", "account", "a2", { beneficiaries: [{ entityIdRef: E }] }),
      draft("add", "account", "a3", { owners: [{ kind: "gifted_away", recipient: { kind: "family_member", id: E }, percent: 1 }] }),
    ]);
    expect(groups[0].targetIds).toEqual([E, "a1", "a2"]);
  });

  it("includes the new charity named by a split-interest trust", () => {
    const groups = trustSetupGroups([
      trustAdd({ splitInterest: { charityId: "ch-new" } }),
      draft("add", "external_beneficiary", "ch-new", { id: "ch-new" }),
      draft("add", "external_beneficiary", "ch-other", { id: "ch-other" }),
    ]);
    expect(groups[0].targetIds).toEqual([E, "ch-new"]);
  });

  it("makes no group for a lone trust add or an edit to a base trust", () => {
    expect(trustSetupGroups([trustAdd()])).toEqual([]);
    expect(
      trustSetupGroups([
        draft("edit", "entity", E, { name: { from: "a", to: "b" } }),
        draft("add", "gift", "g1", { recipient: { kind: "entity", id: E } }),
      ]),
    ).toEqual([]);
  });

  it("ignores non-trust entity adds", () => {
    expect(
      trustSetupGroups([
        draft("add", "entity", "biz", { id: "biz", entityType: "llc" }),
        draft("add", "gift", "g1", { recipient: { kind: "entity", id: "biz" } }),
      ]),
    ).toEqual([]);
  });
});

describe("resolveToggleGroups with a new trust", () => {
  it("tags every member with one id and emits one new group row", () => {
    const drafts = batchDrafts([
      { kind: "gift", gift: cashGift },
      { kind: "retitle", accountId: "acct-brk" },
    ]);
    const r = resolveToggleGroups({
      scenarioId: "s1",
      drafts,
      noteMutations: [],
      noteWrites: new Map(),
      existingGroups: [],
      workingTree: tree(),
      startOrderIndex: 0,
    });
    expect(r.newGroupRows).toHaveLength(1);
    expect(r.newGroupRows[0].name).toBe(`Set up ${NAME}`);
    const ids = new Set([E, "acct-brk", "g-cash"].map((t) => r.groupIdByTarget.get(t)));
    expect(ids).toEqual(new Set([r.newGroupRows[0].id]));
  });

  it("reuses an existing same-name group on a re-save", () => {
    const drafts = batchDrafts([{ kind: "gift", gift: cashGift }]);
    const r = resolveToggleGroups({
      scenarioId: "s1",
      drafts,
      noteMutations: [],
      noteWrites: new Map(),
      existingGroups: [{ id: "grp-old", name: `Set up ${NAME}` }],
      workingTree: tree(),
      startOrderIndex: 3,
    });
    expect(r.newGroupRows).toEqual([]);
    expect(r.groupIdByTarget.get(E)).toBe("grp-old");
  });
});
