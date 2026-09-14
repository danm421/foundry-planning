// src/lib/solver/__tests__/remove-charity.test.ts
//
// Removing a charity used to emit ONE mutation — `external-beneficiary-upsert:
// null` — and `applyMutations` only filters the list. Every reference naming
// that charity was left dangling, and the two halves of the product then
// disagreed about where the money went:
//
//   • the LIVE preview still routed the asset out of the household
//     (death-event/shared.ts:639-643 sets `removed = true` and pays the external
//     beneficiary, whether or not the beneficiary still exists);
//   • the SAVED scenario dropped the ref in `cascadeResolution.ts:305-317` and
//     fell back to the estate.
//
// Preview and save disagreeing about where an asset goes at death is the exact
// failure the spec's Data-flow section calls the correctness property worth
// testing. So the scopes below assert against the ENGINE's own beneficiary pass
// and against `resolveCascades` — the save path's own implementation — not just
// against the mutation list.
import { describe, it, expect } from "vitest";
import { buildRemoveCharityMutations } from "@/lib/solver/charity-levers";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationKey } from "@/lib/solver/types";
import { partitionBaseSavableMutations } from "@/lib/solver/mutations-to-base-updates";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { applyBeneficiaryDesignations } from "@/engine/death-event/shared";
import { resolveCascades } from "@/engine/scenario/cascadeResolution";
import type {
  Account,
  ClientData,
  EntitySummary,
  ExternalBeneficiary,
  FamilyMember,
} from "@/engine/types";

const charity: ExternalBeneficiary = {
  id: "eb-red-cross",
  name: "Red Cross",
  kind: "charity",
  charityType: "public",
};
const otherCharity: ExternalBeneficiary = {
  id: "eb-food-bank",
  name: "Food Bank",
  kind: "charity",
  charityType: "public",
};

const familyMembers = [
  { id: "fm-client", role: "client", firstName: "Dan", lastName: "S", dateOfBirth: "1970-01-01" },
  { id: "fm-spouse", role: "spouse", firstName: "Amy", lastName: "S", dateOfBirth: "1972-01-01" },
] as unknown as FamilyMember[];

function tree(over: Record<string, unknown> = {}): ClientData {
  return {
    client: { dateOfBirth: "1970-01-01", spouseDob: "1972-01-01" },
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    entities: [],
    externalBeneficiaries: [charity, otherCharity],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    familyMembers,
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2060,
      inflationRate: 0.02,
      taxInflationRate: 0.02,
    },
    withdrawalStrategy: [],
    ...over,
  } as unknown as ClientData;
}

/** A policy naming the charity as sole primary beneficiary. */
const policy = {
  id: "acct-pol",
  name: "Term policy",
  category: "life_insurance",
  subType: "term",
  value: 1_000_000,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  // Required by ACCOUNT_VALUE on the wire; engine-inert for a solo-owned
  // account, but a fixture without it is not a representable account.
  titlingType: "jtwros",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  beneficiaries: [
    { id: "b1", tier: "primary", percentage: 100, externalBeneficiaryId: "eb-red-cross", sortOrder: 0 },
  ],
} as unknown as Account;

const accountById = (t: ClientData, id: string) => t.accounts.find((a) => a.id === id)!;

describe("buildRemoveCharityMutations — account beneficiary designations", () => {
  it("makes the live death event agree with the saved scenario about where the policy goes", () => {
    const t = tree({ accounts: [policy] });
    const externalsAfterRemoval: ExternalBeneficiary[] = [otherCharity];

    // CONTROL — the pre-fix shape. One mutation, the list filtered, the ref left
    // behind: the engine still claims the whole policy for a charity that is no
    // longer in the plan.
    const dangling = applyMutations(t, [
      { kind: "external-beneficiary-upsert", id: charity.id, value: null },
    ]);
    const before = applyBeneficiaryDesignations(
      accountById(dangling, "acct-pol"), 1, familyMembers, externalsAfterRemoval, [], undefined,
    );
    expect(before.fractionClaimed).toBe(1);
    expect(before.resultingAccounts).toHaveLength(0); // paid out of the household

    // The lever: nothing is claimed by designation, so the policy falls through
    // to the will / estate — which is what the SAVED scenario already did.
    const out = applyMutations(t, buildRemoveCharityMutations(t, charity.id));
    expect(accountById(out, "acct-pol").beneficiaries).toEqual([]);
    const after = applyBeneficiaryDesignations(
      accountById(out, "acct-pol"), 1, familyMembers, externalsAfterRemoval, [], undefined,
    );
    expect(after.fractionClaimed).toBe(0);
  });

  it("keeps a sibling designation, and its percentage as a NUMBER", () => {
    const shared = {
      ...policy,
      beneficiaries: [
        { id: "b1", tier: "primary", percentage: 60, externalBeneficiaryId: "eb-red-cross", sortOrder: 0 },
        { id: "b2", tier: "primary", percentage: 40, familyMemberId: "fm-spouse", sortOrder: 1 },
      ],
    } as unknown as Account;
    const t = tree({ accounts: [shared] });
    const bens = accountById(
      applyMutations(t, buildRemoveCharityMutations(t, charity.id)),
      "acct-pol",
    ).beneficiaries!;
    expect(bens.map((b) => b.id)).toEqual(["b2"]);
    expect(typeof bens[0].percentage).toBe("number");
    expect(bens[0].percentage).toBe(40);
  });

  it("leaves an account naming a DIFFERENT charity alone", () => {
    const other = {
      ...policy,
      id: "acct-other",
      beneficiaries: [
        { id: "b9", tier: "primary", percentage: 100, externalBeneficiaryId: "eb-food-bank", sortOrder: 0 },
      ],
    } as unknown as Account;
    const t = tree({ accounts: [other] });
    expect(buildRemoveCharityMutations(t, charity.id).map(mutationKey)).not.toContain(
      "account-upsert:acct-other",
    );
  });
});

describe("buildRemoveCharityMutations — entity beneficiary lists", () => {
  const crt: EntitySummary = {
    id: "ent-crt",
    name: "Smith CRT",
    entityType: "trust",
    trustSubType: "crt",
    isGrantor: false,
    includeInPortfolio: false,
    beneficiaries: [
      { id: "eb1", tier: "primary", percentage: 100, externalBeneficiaryId: "eb-red-cross", sortOrder: 0 },
      { id: "eb2", tier: "contingent", percentage: 100, familyMemberId: "fm-spouse", sortOrder: 1 },
    ],
    remainderBeneficiaries: [
      { externalBeneficiaryId: "eb-red-cross", percentage: 60, distributionForm: "outright" },
      { familyMemberId: "fm-spouse", percentage: 40, distributionForm: "outright" },
    ],
    incomeBeneficiaries: [
      { externalBeneficiaryId: "eb-red-cross", percentage: 100 },
      { familyMemberId: "fm-spouse", percentage: 0 },
    ],
  };

  it("clears the charity from all three beneficiary lists in ONE entity-upsert", () => {
    const t = tree({ entities: [crt] });
    const muts = buildRemoveCharityMutations(t, charity.id);
    expect(muts.map(mutationKey).filter((k) => k === "entity-upsert:ent-crt")).toHaveLength(1);

    const after = applyMutations(t, muts).entities!.find((e) => e.id === "ent-crt")!;
    // Positive assertions first: dropping each array whole would satisfy the
    // absences below vacuously.
    expect(after.beneficiaries).toHaveLength(1);
    expect(after.remainderBeneficiaries).toHaveLength(1);
    expect(after.incomeBeneficiaries).toHaveLength(1);
    expect(after.beneficiaries!.map((b) => b.externalBeneficiaryId)).not.toContain(charity.id);
    expect(after.remainderBeneficiaries!.map((r) => r.externalBeneficiaryId)).not.toContain(charity.id);
    expect(after.incomeBeneficiaries!.map((r) => r.externalBeneficiaryId)).not.toContain(charity.id);
  });

  it("emits nothing for an entity that never named the charity", () => {
    const plain: EntitySummary = { ...crt, id: "ent-plain", beneficiaries: [], remainderBeneficiaries: [], incomeBeneficiaries: [] };
    const t = tree({ entities: [plain] });
    expect(buildRemoveCharityMutations(t, charity.id).map(mutationKey)).not.toContain(
      "entity-upsert:ent-plain",
    );
  });
});

describe("buildRemoveCharityMutations — wills", () => {
  it("clears a bequest recipient naming the charity", () => {
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client",
          bequests: [
            {
              id: "bq-1", name: "To the Red Cross", kind: "asset", assetMode: "specific",
              accountId: "acct-pol", entityId: null, liabilityId: null, percentage: 100,
              condition: "always", sortOrder: 0,
              recipients: [
                { recipientKind: "external_beneficiary", recipientId: "eb-red-cross", percentage: 60, sortOrder: 0 },
                { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 40, sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    });
    const out = applyMutations(t, buildRemoveCharityMutations(t, charity.id));
    const recipients = out.wills![0].bequests[0].recipients;
    expect(recipients.map((r) => r.recipientId)).toEqual(["fm-spouse"]);
  });

  it("drops a bequest the charity was the ONLY recipient of", () => {
    // Not inert: an emptied clause still contributes its `percentage` to
    // `rawTotal` and pro-rates a surviving sibling clause down.
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client",
          bequests: [
            {
              id: "bq-charity", name: "To the Red Cross", kind: "asset", assetMode: "specific",
              accountId: "acct-pol", entityId: null, liabilityId: null, percentage: 60,
              condition: "always", sortOrder: 0,
              recipients: [
                { recipientKind: "external_beneficiary", recipientId: "eb-red-cross", percentage: 100, sortOrder: 0 },
              ],
            },
            {
              id: "bq-spouse", name: "To Amy", kind: "asset", assetMode: "specific",
              accountId: "acct-pol", entityId: null, liabilityId: null, percentage: 60,
              condition: "always", sortOrder: 1,
              recipients: [
                { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
              ],
            },
          ],
        },
      ],
    });
    const out = applyMutations(t, buildRemoveCharityMutations(t, charity.id));
    expect(out.wills![0].bequests.map((b) => b.id)).toEqual(["bq-spouse"]);
  });

  it("clears a residuary recipient naming the charity, keeping the sibling's share as a number", () => {
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client", bequests: [],
          residuaryRecipients: [
            { recipientKind: "external_beneficiary", recipientId: "eb-red-cross", percentage: 60, sortOrder: 0 },
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 40, sortOrder: 1 },
          ],
        },
      ],
    });
    const residuary = applyMutations(t, buildRemoveCharityMutations(t, charity.id)).wills![0]
      .residuaryRecipients!;
    expect(residuary.map((r) => r.recipientId)).toEqual(["fm-spouse"]);
    expect(typeof residuary[0].percentage).toBe("number");
    expect(residuary[0].percentage).toBe(40);
  });

  it("leaves a will that never named the charity alone", () => {
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client", bequests: [],
          residuaryRecipients: [
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
    });
    expect(buildRemoveCharityMutations(t, charity.id).some((m) => m.kind === "will-upsert")).toBe(false);
  });
});

describe("buildRemoveCharityMutations — planned gifts", () => {
  it("removes a cash gift aimed at the charity from the APPLIED tree", () => {
    const t = tree({
      gifts: [
        {
          id: "gift-1", year: 2027, amount: 25_000, grantor: "client",
          recipientExternalBeneficiaryId: "eb-red-cross", useCrummeyPowers: false,
        },
      ],
      giftEvents: [
        {
          kind: "cash", year: 2027, amount: 25_000, grantor: "client",
          recipientExternalBeneficiaryId: "eb-red-cross", useCrummeyPowers: false,
          sourceGiftId: "gift-1",
        },
      ],
    });
    const out = applyMutations(t, buildRemoveCharityMutations(t, charity.id));
    expect(out.gifts ?? []).toHaveLength(0);
    expect(out.giftEvents).toHaveLength(0);
  });

  it("removes an ASSET gift aimed at the charity, which never appears in tree.gifts", () => {
    const t = tree({
      giftEvents: [
        {
          kind: "asset", year: 2027, accountId: "acct-9", percent: 1, grantor: "client",
          recipientExternalBeneficiaryId: "eb-red-cross", sourceGiftId: "gift-asset",
        },
      ],
    });
    expect(buildRemoveCharityMutations(t, charity.id)).toContainEqual({
      kind: "gift-upsert", id: "gift-asset", value: null,
    });
  });

  it("leaves a gift aimed at somebody else alone", () => {
    const t = tree({
      gifts: [
        {
          id: "gift-2", year: 2027, amount: 20_000, grantor: "client",
          recipientFamilyMemberId: "fm-spouse", useCrummeyPowers: false,
        },
      ],
    });
    expect(buildRemoveCharityMutations(t, charity.id).some((m) => m.kind === "gift-upsert")).toBe(false);
  });
});

describe("buildRemoveCharityMutations — the removal is base-savable all or nothing", () => {
  it("declares the charity on the designation clears, so Save-to-base cannot take them alone", () => {
    const t = tree({ accounts: [policy] });
    const muts = buildRemoveCharityMutations(t, charity.id);
    const accountEdits = muts.filter((m) => m.kind === "account-upsert");
    // Positive first: there really is a base-savable mutation to declare.
    expect(accountEdits).toHaveLength(1);
    expect(accountEdits[0]).toHaveProperty("removedRefId", charity.id);

    const { savable, held, heldRemovedCharityIds } = partitionBaseSavableMutations(muts);
    expect(savable).toEqual([]);
    expect(held).toHaveLength(muts.length);
    expect(heldRemovedCharityIds).toEqual([charity.id]);
  });

  it("keeps the declaration on the wire — a z.object strips what it does not declare", () => {
    const t = tree({ accounts: [policy] });
    for (const m of buildRemoveCharityMutations(t, charity.id)) {
      if (m.kind !== "account-upsert") continue;
      const parsed = SOLVER_MUTATION_SCHEMA.safeParse(m);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toHaveProperty("removedRefId", charity.id);
    }
  });
});

describe("buildRemoveCharityMutations — ordering and the delete itself", () => {
  it("emits the external-beneficiary delete LAST, so no intermediate tree points at a dead charity", () => {
    const t = tree({ accounts: [policy] });
    const muts = buildRemoveCharityMutations(t, charity.id);
    const last = muts[muts.length - 1];
    expect(last).toEqual({ kind: "external-beneficiary-upsert", id: charity.id, value: null });
    expect(muts.filter((m) => m.kind === "external-beneficiary-upsert")).toHaveLength(1);
  });

  it("still emits the delete for a charity nothing refers to", () => {
    const t = tree();
    expect(buildRemoveCharityMutations(t, charity.id)).toEqual([
      { kind: "external-beneficiary-upsert", id: charity.id, value: null },
    ]);
  });
});

// ── The property the spec names: preview and save must agree ─────────────────

describe("buildRemoveCharityMutations — the preview matches the saved scenario", () => {
  it("lands on the same beneficiary and will shapes as the save path's own cascade", () => {
    const crt: EntitySummary = {
      id: "ent-crt", name: "Smith CRT", entityType: "trust", trustSubType: "crt",
      isGrantor: false, includeInPortfolio: false,
      beneficiaries: [
        { id: "eb1", tier: "primary", percentage: 100, externalBeneficiaryId: "eb-red-cross", sortOrder: 0 },
        { id: "eb2", tier: "contingent", percentage: 100, familyMemberId: "fm-spouse", sortOrder: 1 },
      ],
    };
    const t = tree({
      accounts: [policy],
      entities: [crt],
      wills: [
        {
          id: "will-1", grantor: "client",
          bequests: [
            {
              id: "bq-1", name: "To the Red Cross", kind: "asset", assetMode: "specific",
              accountId: "acct-pol", entityId: null, liabilityId: null, percentage: 100,
              condition: "always", sortOrder: 0,
              recipients: [
                { recipientKind: "external_beneficiary", recipientId: "eb-red-cross", percentage: 60, sortOrder: 0 },
                { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 40, sortOrder: 1 },
              ],
            },
          ],
          residuaryRecipients: [
            { recipientKind: "external_beneficiary", recipientId: "eb-red-cross", percentage: 60, sortOrder: 0 },
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 40, sortOrder: 1 },
          ],
        },
      ],
    });

    // What the SAVED scenario produces on reload: the row is gone and
    // resolveCascades drops the dangling refs, in place.
    const saved = structuredClone(t);
    saved.externalBeneficiaries = (saved.externalBeneficiaries ?? []).filter(
      (b) => b.id !== charity.id,
    );
    resolveCascades(saved, [
      { kind: "external_beneficiary", id: charity.id, causedByChangeId: "chg-1" },
    ]);

    const preview = applyMutations(t, buildRemoveCharityMutations(t, charity.id));

    // Positive first — the cascade really did clear something, so an equality
    // against an untouched tree could not pass.
    expect(saved.accounts[0].beneficiaries).toEqual([]);
    // Compared by account id: `applyMutations` also mints the CRT's synthesized
    // cash bucket on an entity-upsert, which the loader mints on reload too, so
    // a positional compare would fail on a row that is not a divergence.
    const bensById = (t: ClientData) =>
      Object.fromEntries(t.accounts.map((a) => [a.id, a.beneficiaries]));
    const savedBens = bensById(saved);
    const previewBens = bensById(preview);
    expect(Object.keys(savedBens)).toEqual(["acct-pol"]);
    for (const id of Object.keys(savedBens)) {
      expect(previewBens[id]).toEqual(savedBens[id]);
    }
    expect(preview.entities!.map((e) => e.beneficiaries)).toEqual(
      saved.entities!.map((e) => e.beneficiaries),
    );
    expect(preview.wills).toEqual(saved.wills);
    expect(preview.externalBeneficiaries).toEqual(saved.externalBeneficiaries);
  });
});
