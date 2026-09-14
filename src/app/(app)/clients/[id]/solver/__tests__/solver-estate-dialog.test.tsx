// @vitest-environment jsdom
//
// The estate dialog, reorganized around a rail and a detail pane. Every scope
// asserts its control RENDERS before asserting behaviour — a scope that passes
// without the control on screen is a false negative.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "@/lib/solver/types";
import { buildDissolveTrustMutations } from "@/lib/solver/trust-levers";
import { SolverEstateTechnique } from "../solver-estate-technique";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

// ── Fixture ───────────────────────────────────────────────────────────────────
//
// Two BASE-plan trusts and a BASE-plan charity: the old dialog rendered the
// first two as dead text and offered no way into either.

const ilit: EntitySummary = {
  id: "e-ilit",
  name: "Smith Family ILIT",
  entityType: "trust",
  trustSubType: "ilit",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  trustee: "Linda",
  grantor: "client",
};

const idgt: EntitySummary = {
  id: "e-idgt",
  name: "2019 IDGT",
  entityType: "trust",
  trustSubType: "idgt",
  isIrrevocable: true,
  isGrantor: true,
  includeInPortfolio: false,
  grantor: "client",
};

/** Household-owned policy naming the ILIT as its primary beneficiary — the one
 *  fact the removal confirmation has to count. */
const policy = {
  id: "a-policy",
  name: "Term Life",
  category: "life_insurance",
  subType: "term",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  beneficiaries: [
    { id: "b-1", tier: "primary", percentage: 100, entityIdRef: "e-ilit", sortOrder: 0 },
  ],
} as unknown as Account;

const brokerage = {
  id: "a-brokerage",
  name: "Joint Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 750_000,
  basis: 400_000,
  growthRate: 0.06,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
    { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
  ],
} as unknown as Account;

/** A rollover IRA the household owns that names the IDGT as its primary
 *  beneficiary — the see-through/conduit pattern. The trust does not OWN it, so
 *  dissolving the trust strips the designation and moves nothing. Counted by no
 *  ownership line and by no policy line, which is how it used to vanish from the
 *  confirmation entirely. */
const conduitIra = {
  id: "a-ira",
  name: "Rollover IRA",
  category: "retirement",
  subType: "traditional_ira",
  value: 2_000_000,
  basis: 0,
  growthRate: 0.05,
  rmdEnabled: true,
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  beneficiaries: [
    { id: "b-ira", tier: "primary", percentage: 100, entityIdRef: "e-idgt", sortOrder: 0 },
  ],
} as unknown as Account;

/** An account the IDGT itself holds — the only shape that produces a
 *  "returns N account(s) to <person>" line. */
const trustBrokerage = {
  id: "a-trust-brokerage",
  name: "IDGT Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 500_000,
  basis: 500_000,
  growthRate: 0.06,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "e-idgt", percent: 1 }],
} as unknown as Account;

/** An operating company the IDGT holds. Dissolving the trust hands a business to
 *  a person; the old copy called that a cross-reference tidy-up. */
const llc: EntitySummary = {
  id: "e-llc",
  name: "Smith Holdings LLC",
  entityType: "llc",
  includeInPortfolio: true,
  isGrantor: false,
  owners: [{ kind: "entity", entityId: "e-idgt", percent: 1 }],
};

/** A second trust that merely NAMES the IDGT as a remainder beneficiary. Nothing
 *  changes hands — this is the reference tidy-up the business must not be
 *  folded in with. */
const namingTrust: EntitySummary = {
  id: "e-naming",
  name: "Bypass Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  grantor: "client",
  remainderBeneficiaries: [
    { entityIdRef: "e-idgt", percentage: 100, distributionForm: "outright" },
  ],
};

/** A trust a third party funded: `grantor` is undefined, which the engine type
 *  documents as "funded by a third party". The lever falls back to the primary
 *  client; the spec says the confirmation has to say so. */
const thirdPartyTrust: EntitySummary = {
  id: "e-third",
  name: "Grandma's Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
};

const thirdPartyAccount = {
  id: "a-third",
  name: "Grandma's Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 300_000,
  basis: 200_000,
  growthRate: 0.05,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "e-third", percent: 1 }],
} as unknown as Account;

/** A trust that exists only in the working tree — added in this solver session,
 *  with no `entities` row behind it. */
const addedTrust: EntitySummary = {
  id: "e-added",
  name: "2026 Solver IDGT",
  entityType: "trust",
  trustSubType: "idgt",
  isIrrevocable: true,
  isGrantor: true,
  includeInPortfolio: false,
  grantor: "client",
};

const gift: EstateFlowGift = {
  kind: "cash-once",
  id: "g1",
  year: 2030,
  amount: 10_000,
  grantor: "client",
  recipient: { kind: "family_member", id: "fm-child" },
  crummey: false,
};

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: {
      firstName: "Sam",
      lastName: "Smith",
      dateOfBirth: "1965-04-02",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Lee",
      spouseDob: "1967-06-11",
    },
    accounts: [policy, brokerage],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0.24,
      flatStateRate: 0.05,
      inflationRate: 0.025,
      taxInflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2028,
    },
    entities: [ilit, idgt],
    entityFlowOverrides: [],
    familyMembers: [
      {
        id: "fm-client",
        role: "client",
        relationship: "other",
        firstName: "Sam",
        lastName: "Smith",
        dateOfBirth: "1965-04-02",
      },
      {
        id: "fm-spouse",
        role: "spouse",
        relationship: "other",
        firstName: "Lee",
        lastName: "Smith",
        dateOfBirth: "1967-06-11",
      },
    ],
    externalBeneficiaries: [
      { id: "x-red-cross", name: "Red Cross", kind: "charity", charityType: "public" },
    ],
    notesReceivable: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    ...over,
  } as unknown as ClientData;
}

function renderDialog(
  over: { baseGifts?: EstateFlowGift[]; clientData?: ClientData } = {},
) {
  const onChange = vi.fn<(m: SolverMutation) => void>();
  const base = tree();
  render(
    <SolverEstateTechnique
      clientId="c1"
      baseClientData={base}
      clientData={over.clientData ?? base}
      baseGifts={over.baseGifts ?? []}
      onChange={onChange}
      open
    />,
  );
  return { onChange };
}

const railButton = (name: RegExp) => screen.getByRole("button", { name });

// ── Rail ──────────────────────────────────────────────────────────────────────

describe("Estate planning dialog — rail", () => {
  it("lists every existing trust and charity, not just session-added ones", () => {
    renderDialog();
    expect(screen.getByRole("navigation", { name: /estate plan/i })).toBeInTheDocument();
    expect(railButton(/Smith Family ILIT/)).toBeInTheDocument();
    expect(railButton(/2019 IDGT/)).toBeInTheDocument();
    expect(railButton(/Red Cross/)).toBeInTheDocument();
  });

  it("badges a base-plan trust so the advisor can tell it from a scenario addition", () => {
    renderDialog();
    expect(railButton(/Smith Family ILIT/)).toHaveTextContent(/Base plan/i);
  });

  it("opens the full editor for an EXISTING trust — the old dialog showed dead text", async () => {
    renderDialog();
    await userEvent.click(railButton(/Smith Family ILIT/));
    expect(screen.getByLabelText("Trustee")).toBeInTheDocument();
    expect(screen.getByLabelText("Trustee")).toHaveValue("Linda");
  });

  it("offers Remove on an existing trust", async () => {
    renderDialog();
    await userEvent.click(railButton(/Smith Family ILIT/));
    expect(screen.getByRole("button", { name: "Remove trust" })).toBeInTheDocument();
  });

  it("keeps the revocable-living-trust switch on Overview and nowhere else", async () => {
    renderDialog();
    // Overview is the landing pane…
    expect(screen.getByText("Create a revocable living trust")).toBeInTheDocument();
    // …and the panes swap by RENDER, not by a Tailwind `hidden` class jsdom
    // cannot see, so a null query here is a real assertion.
    await userEvent.click(railButton(/2019 IDGT/));
    expect(screen.queryByText("Create a revocable living trust")).toBeNull();
  });

  it("shows the planned-gift list on its own rail destination", async () => {
    renderDialog({ baseGifts: [gift] });
    await userEvent.click(railButton(/Planned gifts/i));
    const dialog = screen.getByRole("dialog", { name: /estate planning/i });
    expect(within(dialog).getByText(/Cash gift 2030/)).toBeInTheDocument();
  });
});

// ── Removing a trust ──────────────────────────────────────────────────────────

describe("Estate planning dialog — removing a trust", () => {
  it("names what the removal will also clear", async () => {
    renderDialog();
    await userEvent.click(railButton(/Smith Family ILIT/));
    await userEvent.click(screen.getByRole("button", { name: "Remove trust" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/beneficiary of 1 policy/i);
  });

  it("emits nothing until the advisor confirms", async () => {
    const { onChange } = renderDialog();
    await userEvent.click(railButton(/Smith Family ILIT/));
    await userEvent.click(screen.getByRole("button", { name: "Remove trust" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep trust" }));
    expect(screen.getByLabelText("Trustee")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dissolves a BASE-plan trust on confirm, entity delete last", async () => {
    const { onChange } = renderDialog();
    await userEvent.click(railButton(/Smith Family ILIT/));
    await userEvent.click(screen.getByRole("button", { name: "Remove trust" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove trust" }));

    const emitted = onChange.mock.calls.map(([m]) => m);
    // The policy's beneficiary designation is cleared…
    const policyUpsert = emitted.find(
      (m): m is Extract<SolverMutation, { kind: "account-upsert" }> =>
        m.kind === "account-upsert" && m.id === "a-policy",
    );
    expect(policyUpsert?.value?.beneficiaries).toEqual([]);
    // …and the entity delete is last.
    expect(emitted[emitted.length - 1]).toEqual({
      kind: "entity-upsert",
      id: "e-ilit",
      value: null,
    });
  });
});

// ── Charities ─────────────────────────────────────────────────────────────────

describe("Estate planning dialog — charity editor", () => {
  it("edits an existing charity's name", async () => {
    const { onChange } = renderDialog();
    await userEvent.click(railButton(/Red Cross/));
    const name = screen.getByLabelText("Charity name");
    expect(name).toHaveValue("Red Cross");
    await userEvent.clear(name);
    await userEvent.type(name, "Red Crescent");

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last?.kind).toBe("external-beneficiary-upsert");
    expect(last).toEqual({
      kind: "external-beneficiary-upsert",
      id: "x-red-cross",
      value: {
        id: "x-red-cross",
        name: "Red Crescent",
        kind: "charity",
        charityType: "public",
      },
    });
  });

  it("removes a charity", async () => {
    const { onChange } = renderDialog();
    await userEvent.click(railButton(/Red Cross/));
    await userEvent.click(screen.getByRole("button", { name: "Remove charity" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "external-beneficiary-upsert",
      id: "x-red-cross",
      value: null,
    });
  });
});

// ── What the confirmation CLAIMS vs what the lever DOES ───────────────────────
//
// Every count in the confirmation is read back off `buildDissolveTrustMutations`
// by array identity — the lever allocates a fresh `owners` / `beneficiaries`
// array only when it actually rewrites one. The scopes below are what stops that
// technique shipping unpinned: each asserts a line the old copy either folded
// into another count or dropped on the floor.

/** Open a trust's removal confirmation. Returns the estate dialog element. */
async function openRemoveConfirm(name: RegExp) {
  await userEvent.click(railButton(name));
  await userEvent.click(screen.getByRole("button", { name: "Remove trust" }));
  return screen.getByRole("dialog", { name: /estate planning/i });
}

describe("Estate planning dialog — the removal confirmation agrees with the lever", () => {
  it("names a NON-insurance beneficiary designation the removal will wipe", async () => {
    renderDialog({ clientData: tree({ accounts: [policy, brokerage, conduitIra] }) });
    const dialog = await openRemoveConfirm(/2019 IDGT/);
    // A see-through IRA is the only thing this trust touches. Saying nothing
    // refers to it, then clearing the designation, is the critical defect.
    expect(dialog).not.toHaveTextContent(/Nothing else in the plan refers to this trust/i);
    expect(dialog).toHaveTextContent(
      /beneficiary designation naming the trust from 1 other account/i,
    );
    // …and it must never be folded into the policy count.
    expect(dialog).not.toHaveTextContent(/polic(y|ies)/i);
  });

  it("still counts a life-insurance policy as a policy, on its own line", async () => {
    renderDialog({ clientData: tree({ accounts: [policy, brokerage, conduitIra] }) });
    const dialog = await openRemoveConfirm(/Smith Family ILIT/);
    expect(dialog).toHaveTextContent(/beneficiary of 1 policy/i);
    expect(dialog).not.toHaveTextContent(/beneficiary designation naming the trust/i);
  });

  it("says a business is changing hands rather than calling it a cross-reference", async () => {
    renderDialog({
      clientData: tree({ entities: [ilit, idgt, llc, namingTrust] }),
    });
    const dialog = await openRemoveConfirm(/2019 IDGT/);
    expect(dialog).toHaveTextContent(/ownership of 1 business to Sam Smith/i);
    // The trust that merely NAMES the IDGT is still reported — separately.
    expect(dialog).toHaveTextContent(/Clears it from 1 other entity/i);
  });

  it("returns a trust-OWNED account to the grantor BY NAME, and the lever agrees", async () => {
    const working = tree({ accounts: [policy, brokerage, trustBrokerage] });
    renderDialog({ clientData: working });
    const dialog = await openRemoveConfirm(/2019 IDGT/);
    expect(dialog).toHaveTextContent(/Returns 1 account to Sam Smith/i);

    // The name on screen is copy; this is the fact behind it. The confirmation
    // resolves the heir locally because the lever's own resolver is private, so
    // both halves are asserted together — either one drifting fails this scope.
    const upsert = buildDissolveTrustMutations(working, idgt).find(
      (m): m is Extract<SolverMutation, { kind: "account-upsert" }> =>
        m.kind === "account-upsert" && m.id === "a-trust-brokerage",
    );
    expect(upsert?.value?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("names the trust income and expense the removal returns to the household", async () => {
    // Spec §4 step 5. Left unimplemented these rows did not come home, they
    // vanished from the projection — so the confirmation naming them is the
    // advisor's only sight of a move that really happens.
    const working = tree({
      incomes: [
        {
          id: "i-trust",
          type: "trust",
          name: "IDGT distribution",
          annualAmount: 60_000,
          startYear: 2026,
          endYear: 2028,
          growthRate: 0,
          owner: "client",
          ownerEntityId: "e-idgt",
        },
      ],
      expenses: [
        {
          id: "x-trust",
          type: "other",
          name: "Trustee fee",
          annualAmount: 12_000,
          startYear: 2026,
          endYear: 2028,
          growthRate: 0,
          ownerEntityId: "e-idgt",
        },
      ],
    } as unknown as Partial<ClientData>);
    renderDialog({ clientData: working });
    const dialog = await openRemoveConfirm(/2019 IDGT/);
    expect(dialog).toHaveTextContent(/Returns 1 income to Sam Smith/i);
    expect(dialog).toHaveTextContent(/Moves 1 expense back to Sam Smith/i);
    expect(dialog).not.toHaveTextContent(/Nothing else in the plan refers to this trust/i);
  });

  it("shows NO returns line for an account that only names the trust", async () => {
    renderDialog({ clientData: tree({ accounts: [policy, brokerage, conduitIra] }) });
    const dialog = await openRemoveConfirm(/2019 IDGT/);
    expect(dialog).toHaveTextContent(
      /beneficiary designation naming the trust from 1 other account/i,
    );
    expect(dialog).not.toHaveTextContent(/Returns \d+ account/i);
  });

  it("says so when a third-party trust falls back to the primary client", async () => {
    renderDialog({
      clientData: tree({
        accounts: [policy, brokerage, thirdPartyAccount],
        entities: [ilit, idgt, thirdPartyTrust],
      }),
    });
    const dialog = await openRemoveConfirm(/Grandma's Trust/);
    expect(dialog).toHaveTextContent(/Returns 1 account to Sam Smith/i);
    expect(dialog).toHaveTextContent(/no grantor on file/i);
  });

  it("never claims assets return to anyone when nothing moves", async () => {
    renderDialog({ clientData: tree({ entities: [ilit, idgt, thirdPartyTrust] }) });
    const dialog = await openRemoveConfirm(/Grandma's Trust/);
    expect(dialog).toHaveTextContent(/Nothing else in the plan refers to this trust/i);
    expect(dialog).not.toHaveTextContent(/no grantor on file/i);
  });

  it("refuses to summarise a removal it cannot compute, instead of blanking the dialog", async () => {
    // The lever throws on a household with no primary client. Computed at
    // render, that throw would unmount the modal behind an "Application error".
    renderDialog({ clientData: tree({ familyMembers: [] }) });
    const dialog = await openRemoveConfirm(/Smith Family ILIT/);
    expect(dialog).toHaveTextContent(/no primary client on file/i);
    expect(screen.getByRole("button", { name: "Remove trust" })).toBeDisabled();
    // Backing out still works.
    await userEvent.click(screen.getByRole("button", { name: "Keep trust" }));
    expect(screen.getByLabelText("Trustee")).toBeInTheDocument();
  });
});

// ── Base plan vs this scenario ────────────────────────────────────────────────
//
// `isBase` is derived from the BASE tree, never the working one — the working
// tree holds solver-added trusts, which is the exact case the flag excludes. It
// drives the rail badge AND `isPersisted`, which gates the promissory-note
// surface: a note carries an FK to `entities.id`, so a trust the database has
// never seen would 500 the save. These scopes hand the working tree a trust and
// a charity the base tree does not have, which is the only shape that can tell
// the two derivations apart.

const workingWithAdditions = () =>
  tree({
    entities: [ilit, idgt, addedTrust],
    externalBeneficiaries: [
      { id: "x-red-cross", name: "Red Cross", kind: "charity", charityType: "public" },
      { id: "x-food-bank", name: "City Food Bank", kind: "charity", charityType: "public" },
    ],
  });

describe("Estate planning dialog — base plan vs this scenario", () => {
  it("badges a scenario addition apart from a base-plan row", () => {
    renderDialog({ clientData: workingWithAdditions() });
    expect(railButton(/2026 Solver IDGT/)).toHaveTextContent(/Added/i);
    expect(railButton(/Smith Family ILIT/)).toHaveTextContent(/Base plan/i);
    expect(railButton(/City Food Bank/)).toHaveTextContent(/Added/i);
    expect(railButton(/Red Cross/)).toHaveTextContent(/Base plan/i);
  });

  it("gates the promissory-note surface on the BASE tree, not the working one", async () => {
    renderDialog({ clientData: workingWithAdditions() });

    await userEvent.click(railButton(/2026 Solver IDGT/));
    expect(
      screen.getByText(/This trust exists only in the solver so far/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sell an asset to the trust/i }),
    ).toBeNull();

    await userEvent.click(railButton(/2019 IDGT/));
    expect(
      screen.getByRole("button", { name: /Sell an asset to the trust/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This trust exists only in the solver so far/i)).toBeNull();
  });
});
