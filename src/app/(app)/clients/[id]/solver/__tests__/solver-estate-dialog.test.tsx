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
