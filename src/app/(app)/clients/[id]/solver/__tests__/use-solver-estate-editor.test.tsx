// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { SolverTrustDraft } from "../solver-trust-form";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { useSolverEstateEditor } from "../use-solver-estate-editor";

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
    expenses: {},
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

function setup(over: { baseGifts?: EstateFlowGift[]; working?: ClientData } = {}) {
  const onChange = vi.fn<(m: SolverMutation) => void>();
  const base = clientData();
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
// scopes seed one through `addTrust` (with no mutations of its own) rather than
// handing it to `removeTrust`.

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

    act(() =>
      view.result.current.addTrust([], {
        entity: ilit,
        fundedOriginals: [fundedOriginal],
      } as SolverTrustDraft),
    );
    act(() => view.result.current.removeTrust(ilit));

    const upsert = accountUpserts(onChange).find((m) => m.id === "acct-funded");
    // The 50/50 split survives. The lever alone would have returned the whole
    // account to the grantor, moving half of it away from the co-client.
    expect(upsert?.value?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ]);
  });

  it("falls back to the lever's retitle for a trust-owned account this session did NOT fund", () => {
    const baseHeld = inTrust({ ...fundedOriginal, id: "acct-base", name: "Trust brokerage" });
    const working = clientData({
      entities: [ilit],
      accounts: [baseHeld],
      familyMembers,
    } as unknown as Partial<ClientData>);
    const { view, onChange } = setup({ working });

    act(() =>
      view.result.current.addTrust([], { entity: ilit, fundedOriginals: [] } as SolverTrustDraft),
    );
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

    act(() =>
      view.result.current.addTrust([], {
        entity: ilit,
        fundedOriginals: [fundedOriginal],
      } as SolverTrustDraft),
    );
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

    act(() =>
      view.result.current.addTrust([], {
        entity: ilit,
        fundedOriginals: [fundedOriginal],
      } as SolverTrustDraft),
    );
    act(() => view.result.current.removeTrust(ilit));

    expect(accountUpserts(onChange)).toHaveLength(0);
    expect(onChange.mock.calls.map(([m]) => m as SolverMutation)).toEqual([
      { kind: "entity-upsert", id: "ent-ilit", value: null },
    ]);
  });
});
