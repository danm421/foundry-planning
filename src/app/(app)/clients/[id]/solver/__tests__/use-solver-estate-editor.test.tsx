// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { SolverTrustDraft } from "@/lib/solver/guided-trust";
import type { GuidedTrustBatch } from "@/lib/solver/guided-trust-batch";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { useSolverEstateEditor } from "../use-solver-estate-editor";
import { partitionBaseSavableMutations } from "@/lib/solver/mutations-to-base-updates";

const planSettings = {
  planStartYear: 2026,
  planEndYear: 2060,
  inflationRate: 0.025,
  taxInflationRate: 0.025,
};

function clientData(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { spouseDob: null },
    accounts: [],
    entities: [],
    externalBeneficiaries: [],
    incomes: [],
    // `Expense[]`, not `{}` — the dissolve lever walks this array (spec §4
    // step 5), and an object fixture throws where real data never could.
    expenses: [],
    savingsRules: [],
    liabilities: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    planSettings,
    ...over,
  } as unknown as ClientData;
}

const gift: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 10000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function setup(
  over: { baseGifts?: EstateFlowGift[]; working?: ClientData; base?: ClientData } = {},
) {
  const onChange = vi.fn<(m: SolverMutation) => void>();
  const base = over.base ?? clientData();
  const view = renderHook(() =>
    useSolverEstateEditor({
      baseClientData: base,
      clientData: over.working ?? base,
      baseGifts: over.baseGifts ?? [],
      onChange,
    }),
  );
  return { onChange, view };
}

describe("useSolverEstateEditor", () => {
  it("reports an empty summary when nothing is configured", () => {
    const { view } = setup();
    expect(view.result.current.summary.isEmpty).toBe(true);
    expect(view.result.current.summary.giftCount).toBe(0);
  });

  it("counts an active base gift and drops it from the count when toggled off", () => {
    const { view, onChange } = setup({ baseGifts: [gift] });
    expect(view.result.current.summary.giftCount).toBe(1);
    expect(view.result.current.summary.isEmpty).toBe(false);

    act(() => view.result.current.toggleGift(gift));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "gift-upsert", id: "g1" }),
    );
    expect(view.result.current.summary.giftCount).toBe(0);
  });
});

// ── removeTrust ─────────────────────────────────────────────────────────────
//
// `removeTrust` takes the TRUST, not a draft, so the rail can offer Remove on a
// base-plan trust as well as one added here. It dispatches
// `buildDissolveTrustMutations` over the WORKING tree and swaps an exact restore
// in for any account this session funded — the swap picks between two DIFFERENT
// money outcomes for the same account, so both arms need covering: the exact
// prior owners, or the lever's return-to-grantor rule.
//
// A draft exists only for a trust `addTrust` created here, which is why these
// scopes seed one through `addTrust` (a batch with no mutations of its own)
// rather than handing it to `removeTrust`.

const ilit: EntitySummary = {
  id: "ent-ilit",
  name: "Smith Family ILIT",
  entityType: "trust",
  trustSubType: "ilit",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  grantor: "client",
};

const familyMembers = [
  { id: "fm-client", role: "client", firstName: "Dan", lastName: "S", dateOfBirth: "1970-01-01" },
  { id: "fm-spouse", role: "spouse", firstName: "Amy", lastName: "S", dateOfBirth: "1972-01-01" },
];

/** An account as it stood BEFORE this session retitled it into the trust: held
 *  50/50 by the couple, which is precisely what a return-to-grantor rule loses. */
const fundedOriginal = {
  id: "acct-funded",
  name: "Joint brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 400_000,
  basis: 300_000,
  growthRate: 0.05,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
    { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
  ],
} as unknown as Account;

const inTrust = (a: Account): Account => ({
  ...a,
  owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
});

/** A batch that only records a draft — no mutations of its own. */
const draftOnly = (draft: SolverTrustDraft): GuidedTrustBatch => ({
  mutations: [],
  draft,
  select: { kind: "trust", id: draft.entity.id },
});

const accountUpserts = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls
    .map(([m]) => m as SolverMutation)
    .filter((m): m is Extract<SolverMutation, { kind: "account-upsert" }> =>
      m.kind === "account-upsert");

describe("useSolverEstateEditor — removeTrust", () => {
  it("gives a this-session funded account its EXACT prior owners back", () => {
    const working = clientData({
      entities: [ilit],
      accounts: [inTrust(fundedOriginal)],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() => view.result.current.addTrust(draftOnly({ entity: ilit, fundedOriginals: [fundedOriginal] }), []));
    act(() => view.result.current.removeTrust(ilit));

    const upsert = accountUpserts(onChange).find((m) => m.id === "acct-funded");
    // The 50/50 split survives. The lever alone would have returned the whole
    // account to the grantor, moving half of it away from the co-client.
    expect(upsert?.value?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ]);
  });

  it("declares the dissolve on the exact-restore, so Save-to-base cannot take it alone", () => {
    // The restore is swapped in PLACE OF the lever's retitle. Dropping the
    // `removedRefId` declaration there would make this one account
    // base-savable on its own — half a trust removal on the real record.
    const working = clientData({
      entities: [ilit],
      accounts: [inTrust(fundedOriginal)],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() => view.result.current.addTrust(draftOnly({ entity: ilit, fundedOriginals: [fundedOriginal] }), []));
    act(() => view.result.current.removeTrust(ilit));

    const emitted = onChange.mock.calls.map(([m]) => m as SolverMutation);
    expect(accountUpserts(onChange).find((m) => m.id === "acct-funded")).toHaveProperty(
      "removedRefId",
      "ent-ilit",
    );
    expect(partitionBaseSavableMutations(emitted).savable).toEqual([]);
  });

  it("falls back to the lever's retitle for a trust-owned account this session did NOT fund", () => {
    const baseHeld = inTrust({ ...fundedOriginal, id: "acct-base", name: "Trust brokerage" });
    const working = clientData({
      entities: [ilit],
      accounts: [baseHeld],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() => view.result.current.addTrust(draftOnly({ entity: ilit, fundedOriginals: [] }), []));
    act(() => view.result.current.removeTrust(ilit));

    const upsert = accountUpserts(onChange).find((m) => m.id === "acct-base");
    expect(upsert?.value?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("still emits the entity delete LAST, with the restore swapped in ahead of it", () => {
    const working = clientData({
      entities: [ilit],
      accounts: [inTrust(fundedOriginal)],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() => view.result.current.addTrust(draftOnly({ entity: ilit, fundedOriginals: [fundedOriginal] }), []));
    act(() => view.result.current.removeTrust(ilit));

    const emitted = onChange.mock.calls.map(([m]) => m as SolverMutation);
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ kind: "account-upsert", id: "acct-funded" });
    expect(emitted[1]).toEqual({ kind: "entity-upsert", id: "ent-ilit", value: null });
  });

  it("dissolves a BASE-PLAN trust, which this session holds no draft for", () => {
    // The rail offers Remove on every trust, not just the ones added here. A
    // base-plan trust has no `SolverTrustDraft` and no `fundedOriginals`, so
    // every account it holds falls through to the lever's return-to-grantor
    // rule — which is the correct outcome for funding this session never did.
    const baseHeld = inTrust({ ...fundedOriginal, id: "acct-base", name: "Trust brokerage" });
    const working = clientData({
      entities: [ilit],
      accounts: [baseHeld],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() => view.result.current.removeTrust(ilit));

    expect(onChange.mock.calls.map(([m]) => m as SolverMutation)).toEqual([
      {
        kind: "account-upsert",
        id: "acct-base",
        value: expect.objectContaining({
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        }),
        // The dissolve pairing, so Save-to-base cannot take this half alone.
        removedRefId: "ent-ilit",
      },
      { kind: "entity-upsert", id: "ent-ilit", value: null },
    ]);
  });

  it("leaves an account funded here but since retitled elsewhere alone", () => {
    // The previous body reverted every `fundedOriginals` entry unconditionally,
    // which would drag this account back to its pre-funding owners even though
    // the trust no longer holds it.
    const movedOn: Account = {
      ...fundedOriginal,
      owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
    } as unknown as Account;
    const working = clientData({
      entities: [ilit],
      accounts: [movedOn],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() => view.result.current.addTrust(draftOnly({ entity: ilit, fundedOriginals: [fundedOriginal] }), []));
    act(() => view.result.current.removeTrust(ilit));

    expect(accountUpserts(onChange)).toHaveLength(0);
    expect(onChange.mock.calls.map(([m]) => m as SolverMutation)).toEqual([
      { kind: "entity-upsert", id: "ent-ilit", value: null },
    ]);
  });
});

// ── addTrust / addFunding ───────────────────────────────────────────────────

const trustGift: EstateFlowGift = {
  kind: "cash-once", id: "g-trust", year: 2026, amount: 1_000_000, grantor: "client",
  recipient: { kind: "entity", id: "ent-ilit" }, crummey: false,
};

describe("useSolverEstateEditor — addTrust", () => {
  const batch: GuidedTrustBatch = {
    mutations: [
      { kind: "entity-upsert", id: "ent-ilit", value: ilit },
      { kind: "gift-upsert", id: "g-trust", value: trustGift },
    ],
    draft: { entity: ilit, fundedOriginals: [] },
    select: { kind: "trust", id: "ent-ilit" },
  };

  it("emits the batch in order, lists its gifts, and opens the new trust with a notice", () => {
    const { view, onChange } = setup();
    act(() => view.result.current.addTrust(batch, ["Gift $1,000,000 · 2026", "Bequest · everything · Dan's will"]));

    expect(onChange.mock.calls.map(([m]) => m)).toEqual(batch.mutations);
    expect(view.result.current.gifts).toEqual([trustGift]);
    expect(view.result.current.selection).toEqual({ kind: "trust", id: "ent-ilit" });
    expect(view.result.current.notice).toEqual({
      trustId: "ent-ilit",
      text: "Added. Funding: Gift $1,000,000 · 2026; Bequest · everything · Dan's will",
    });
  });

  it("says a trust added with no funding isn't funded yet, and drops the notice on the next move", () => {
    const { view } = setup();
    act(() => view.result.current.addTrust(draftOnly({ entity: ilit, fundedOriginals: [] }), []));
    expect(view.result.current.notice?.text).toBe("Added. Not funded yet.");
    act(() => view.result.current.setSelection({ kind: "overview" }));
    expect(view.result.current.notice).toBeNull();
  });

  it("opens a revocable trust's pane when the batch selects one", () => {
    const { view } = setup();
    act(() =>
      view.result.current.addTrust(
        { mutations: [], draft: null, select: { kind: "revocable", name: "Family Trust" } },
        [],
      ),
    );
    expect(view.result.current.selection).toEqual({ kind: "revocable", name: "Family Trust" });
    expect(view.result.current.notice).toBeNull();
  });
});

describe("useSolverEstateEditor — removeTrust and the gift list", () => {
  it("drops from Planned gifts every gift the dissolve clears", () => {
    // The lever finds the gift on the working tree's cash-gift rows.
    const working = clientData({
      entities: [ilit],
      familyMembers,
      gifts: [{ id: "g-trust", year: 2026, amount: 1_000_000, grantor: "client", recipientEntityId: "ent-ilit" }],
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working, baseGifts: [trustGift, gift] });
    act(() => view.result.current.removeTrust(ilit));

    expect(onChange).toHaveBeenCalledWith({ kind: "gift-upsert", id: "g-trust", value: null });
    expect(view.result.current.gifts.map((g) => g.id)).toEqual(["g1"]);
  });
});

describe("useSolverEstateEditor — addFunding", () => {
  it("emits the funding, lists its gifts, and returns to the trust with a notice", () => {
    const working = clientData({ entities: [ilit], familyMembers } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });
    act(() => view.result.current.setSelection({ kind: "trust", id: "ent-ilit", addingFunding: true }));
    act(() =>
      view.result.current.addFunding(
        "ent-ilit",
        [{ kind: "gift-upsert", id: "g-trust", value: trustGift }],
        [],
        ["Gift $1,000,000 · 2026"],
      ),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(view.result.current.gifts).toEqual([trustGift]);
    expect(view.result.current.selection).toEqual({ kind: "trust", id: "ent-ilit" });
    expect(view.result.current.notice).toEqual({
      trustId: "ent-ilit",
      text: "Added funding: Gift $1,000,000 · 2026",
    });
  });

  it("remembers an account moved in here, so removing the trust restores its owners exactly", () => {
    const working = clientData({
      entities: [ilit],
      accounts: [inTrust(fundedOriginal)],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });
    act(() => view.result.current.addFunding("ent-ilit", [], [fundedOriginal], []));
    act(() => view.result.current.removeTrust(ilit));

    const upsert = accountUpserts(onChange).find((m) => m.id === "acct-funded");
    expect(upsert?.value?.owners).toEqual(fundedOriginal.owners);
  });
});

// ── Revocable trusts ────────────────────────────────────────────────────────

const tagged = (id: string, name: string | null): Account =>
  ({
    id, name: id, category: "taxable", value: 1, owners: [], revocableTrustName: name,
  }) as unknown as Account;

describe("useSolverEstateEditor — revocable trusts", () => {
  const base = clientData({ accounts: [tagged("a1", "Family Trust"), tagged("a2", null)] });

  it("lists base revocable trusts and counts them as trusts", () => {
    const { view } = setup({ base, working: base });
    expect(view.result.current.railRevocableTrusts).toEqual([
      { name: "Family Trust", isBase: true, accountIds: ["a1"] },
    ]);
    expect(view.result.current.summary.trustCount).toBe(1);
    expect(view.result.current.summary.isEmpty).toBe(false);
  });

  it("ticking an account emits only the account whose tag changes", () => {
    const { view, onChange } = setup({ base, working: base });
    act(() => view.result.current.setRevocableMembership("Family Trust", new Set(["a1", "a2"])));
    expect(onChange.mock.calls.map(([m]) => m)).toEqual([
      { kind: "account-upsert", id: "a2", value: expect.objectContaining({ revocableTrustName: "Family Trust" }) },
    ]);
  });

  it("renaming retags every member and follows the trust to its new name", () => {
    const working = clientData({ accounts: [tagged("a1", "Draft Trust"), tagged("a2", "Draft Trust")] });
    const { view, onChange } = setup({ working });
    act(() => view.result.current.setSelection({ kind: "revocable", name: "Draft Trust" }));
    act(() => view.result.current.renameRevocableTrust("Draft Trust", "Lake Trust"));
    expect(onChange.mock.calls.map(([m]) => (m as Extract<SolverMutation, { kind: "account-upsert" }>).value?.revocableTrustName))
      .toEqual(["Lake Trust", "Lake Trust"]);
    expect(view.result.current.selection).toEqual({ kind: "revocable", name: "Lake Trust" });
  });

  it("removing a revocable trust unticks every account and returns to the overview", () => {
    const { view, onChange } = setup({ base, working: base });
    act(() => view.result.current.setSelection({ kind: "revocable", name: "Family Trust" }));
    act(() => view.result.current.removeRevocableTrust("Family Trust"));
    expect(onChange.mock.calls.map(([m]) => m)).toEqual([
      { kind: "account-upsert", id: "a1", value: expect.objectContaining({ revocableTrustName: null }) },
    ]);
    expect(view.result.current.selection).toEqual({ kind: "overview" });
  });

  it("unticking an added trust's last account returns to the overview; a base trust's pane stays open", () => {
    const working = clientData({ accounts: [tagged("a1", "Family Trust"), tagged("a2", "Lake Trust")] });
    const { view } = setup({ base, working });
    act(() => view.result.current.setSelection({ kind: "revocable", name: "Lake Trust" }));
    act(() => view.result.current.setRevocableMembership("Lake Trust", new Set()));
    expect(view.result.current.selection).toEqual({ kind: "overview" });

    act(() => view.result.current.setSelection({ kind: "revocable", name: "Family Trust" }));
    act(() => view.result.current.setRevocableMembership("Family Trust", new Set()));
    expect(view.result.current.selection).toEqual({ kind: "revocable", name: "Family Trust" });
  });
});
