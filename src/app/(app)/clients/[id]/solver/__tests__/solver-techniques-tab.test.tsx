// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SolverTechniquesTab } from "../solver-techniques-tab";
import type { ClientData } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

const rc: {
  id: string;
  name: string;
  destinationAccountId: string;
  sourceAccountIds: string[];
  conversionType: "fixed_amount";
  fixedAmount: number;
  startYear: number;
  endYear: number;
  indexingRate: number;
  enabled?: boolean;
} = {
  id: "rc-1",
  name: "Existing Conv",
  destinationAccountId: "a",
  sourceAccountIds: ["b"],
  conversionType: "fixed_amount" as const,
  fixedAmount: 25000,
  startYear: 2030,
  endYear: 2035,
  indexingRate: 0,
};

/** A sell of a named asset — enough for summarizeAssetTransaction. */
const at = {
  id: "at-1",
  name: "Lake house",
  type: "sell" as const,
  year: 2032,
};

function tree(
  rothConversions = [] as (typeof rc)[],
  assetTransactions = [] as (typeof at)[],
): ClientData {
  return { accounts: [], rothConversions, assetTransactions } as unknown as ClientData;
}

/** Row order as the switches read it, top to bottom. */
function switchLabels(): (string | null)[] {
  return screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"));
}

// MC asset mixes used to prove an inline-created draft Roth registers its
// allocation into the workspace's extraAccountMixes map (so converted dollars
// are randomized in Monte Carlo instead of growing at a fixed zero-vol rate).
const RET_DEFAULT_MIX = [
  { assetClassId: "ac-eq", weight: 0.7 },
  { assetClassId: "ac-bond", weight: 0.3 },
];
const AGG_MIX = [
  { assetClassId: "ac-eq", weight: 0.9 },
  { assetClassId: "ac-bond", weight: 0.1 },
];

const baseProps = {
  clientId: "c1",
  accounts: [],
  liabilities: [],
  modelPortfolios: [],
  milestones: undefined,
};

describe("SolverTechniquesTab", () => {
  it("renders an existing working technique with an Add control", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([rc])}
        onChange={vi.fn()}
      />,
    );
    // The existing conversion appears once on the always-editable surface.
    expect(screen.getAllByText("Existing Conv").length).toBe(1);
    // The Add control is always present for each technique group.
    expect(
      screen.getAllByRole("button", { name: /add roth conversion/i }).length,
    ).toBe(1);
  });

  it("shows Add controls as the empty state when no techniques are present", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([])}
        onChange={vi.fn()}
      />,
    );
    // The always-editable surface uses add-tiles as empty state (no read-only placeholders).
    expect(
      screen.getAllByRole("button", { name: /add roth conversion/i }).length,
    ).toBe(1);
    expect(
      screen.getAllByRole("button", { name: /add asset transaction/i }).length,
    ).toBe(1);
    expect(
      screen.getAllByRole("button", { name: /add reinvestment/i }).length,
    ).toBe(1);
  });

  it("emits a removal mutation when a working row's Remove is clicked", () => {
    const onChange = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([rc])}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove technique/i }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "roth-conversion-upsert",
      id: "rc-1",
      value: null,
    });
  });

  it("shows a Solve control only for fixed-amount roth conversions and fires onSolveStart", () => {
    const onSolveStart = vi.fn();
    const fixedRc = { ...rc, id: "rc-fixed", conversionType: "fixed_amount" as const };
    const fullRc = { ...rc, id: "rc-full", conversionType: "full_account" as const };
    render(
      <SolverTechniquesTab
        {...baseProps}        workingTree={tree([fixedRc, fullRc] as (typeof rc)[])}
        onChange={vi.fn()}
        onSolveStart={onSolveStart}
      />,
    );
    const solveButtons = screen.getAllByRole("button", { name: /solve/i });
    expect(solveButtons).toHaveLength(1); // only the fixed-amount conversion
    fireEvent.click(solveButtons[0]);
    expect(onSolveStart).toHaveBeenCalledWith(
      { kind: "roth-conversion-amount", techniqueId: "rc-fixed" },
      expect.any(Number),
    );
  });

  it("toggles a technique off via an upsert carrying enabled:false", () => {
    const onChange = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([rc])}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: /include existing conv in projection/i }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "roth-conversion-upsert",
        id: "rc-1",
        value: expect.objectContaining({ id: "rc-1", enabled: false }),
      }),
    );
  });

  it("toggles a disabled technique back on (enabled:undefined)", () => {
    const onChange = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([{ ...rc, enabled: false }])}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: /include existing conv in projection/i }),
    );
    const arg = onChange.mock.calls[0][0];
    expect(arg.kind).toBe("roth-conversion-upsert");
    expect(arg.value.enabled).toBeUndefined();
  });

  it("tags a base-plan technique vs an added one", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([rc, { ...rc, id: "rc-2", name: "Added Conv" }])}
        baseTechniqueIds={{
          roth: new Set(["rc-1"]),
          asset: new Set<string>(),
          reinvestment: new Set<string>(),
          relocation: new Set<string>(),
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Base plan")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });

  it("resolves a draft-created Roth as the destination on re-edit (no forced re-create)", () => {
    // Repro: the plan had no Roth, so one was created inline (a draft
    // account-upsert that lives in the working tree, NOT in base accounts).
    // Re-opening the conversion to edit it must still resolve that draft Roth
    // as the destination instead of re-showing the create panel.
    const draftRoth = {
      id: "roth-draft",
      name: "Roth IRA - John",
      category: "retirement",
      subType: "roth_ira",
      value: 0,
      basis: 0,
      growthRate: 0.06,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    };
    const tradIra = {
      id: "trad-1",
      name: "Trad IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 500000,
      basis: 0,
      growthRate: 0.05,
      rmdEnabled: true,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    };
    const conv = { ...rc, id: "rc-draft", destinationAccountId: "roth-draft", sourceAccountIds: ["trad-1"] };
    const workingTree = { accounts: [tradIra, draftRoth], rothConversions: [conv] } as unknown as ClientData;

    render(
      <SolverTechniquesTab
        {...baseProps}
        accounts={[
          { id: "trad-1", name: "Trad IRA", category: "retirement", subType: "traditional_ira", ownerFamilyMemberId: "fm-client" },
        ]}
        workingTree={workingTree}
        owners={[{ familyMemberId: "fm-client", label: "John" }]}
        retirementGrowthDefault={0.06}
        resolvedInflationRate={0.025}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // The draft Roth resolves as the destination — no dead-end / re-create panel.
    expect(screen.queryByRole("button", { name: "Create Roth IRA" })).not.toBeInTheDocument();
    const dest = screen.getByLabelText(/Destination Account/i) as HTMLSelectElement;
    expect(dest.value).toBe("roth-draft");
    expect(within(dest).getByText("Roth IRA - John")).toBeInTheDocument();
  });

  it("emits an account-upsert when a Roth IRA is created inline in the dialog", () => {
    const onChange = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([])}
        owners={[{ familyMemberId: "fm-client", label: "John" }]}
        retirementGrowthDefault={0.06}
        resolvedInflationRate={0.025}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add roth conversion/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "account-upsert",
        value: expect.objectContaining({
          subType: "roth_ira",
          name: "Roth IRA - John",
          growthRate: 0.06,
        }),
      }),
    );
  });

  it("registers the retirement-default mix for an inline Roth created on Plan default growth", () => {
    // The create panel defaults to "Plan default" growth, which for DB accounts
    // resolves to the retirement category default's model-portfolio mix. Parity
    // requires the draft Roth to register that same mix so its converted dollars
    // carry MC volatility instead of a fixed zero-vol growth rate.
    const onChange = vi.fn();
    const onRegisterAccountMix = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([])}
        owners={[{ familyMemberId: "fm-client", label: "John" }]}
        retirementGrowthDefault={0.06}
        resolvedInflationRate={0.025}
        retirementDefaultMix={RET_DEFAULT_MIX}
        onRegisterAccountMix={onRegisterAccountMix}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add roth conversion/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));

    const upsert = onChange.mock.calls
      .map((c) => c[0])
      .find((m) => m.kind === "account-upsert");
    expect(upsert).toBeTruthy();
    // Same account id in the upsert and the mix registration — they describe one account.
    expect(onRegisterAccountMix).toHaveBeenCalledWith(upsert!.value.id, RET_DEFAULT_MIX);
  });

  it("registers the chosen model-portfolio mix for an inline Roth", () => {
    const onChange = vi.fn();
    const onRegisterAccountMix = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([])}
        modelPortfolios={[{ id: "mp-agg", name: "Aggressive", growthRate: 0.08, mix: AGG_MIX }]}
        owners={[{ familyMemberId: "fm-client", label: "John" }]}
        retirementGrowthDefault={0.06}
        resolvedInflationRate={0.025}
        retirementDefaultMix={RET_DEFAULT_MIX}
        onRegisterAccountMix={onRegisterAccountMix}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add roth conversion/i }));
    const growthSelect = screen
      .getByRole("option", { name: /Plan default/i })
      .closest("select") as HTMLSelectElement;
    fireEvent.change(growthSelect, { target: { value: "mp:mp-agg" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));

    const upsert = onChange.mock.calls
      .map((c) => c[0])
      .find((m) => m.kind === "account-upsert");
    expect(upsert!.value.growthRate).toBe(0.08);
    expect(onRegisterAccountMix).toHaveBeenCalledWith(upsert!.value.id, AGG_MIX);
  });

  it("does NOT register a mix for an inline Roth created on custom growth", () => {
    // custom / inflation growth are deterministic by design — no mix synthesized.
    const onChange = vi.fn();
    const onRegisterAccountMix = vi.fn();
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([])}
        owners={[{ familyMemberId: "fm-client", label: "John" }]}
        retirementGrowthDefault={0.06}
        resolvedInflationRate={0.025}
        retirementDefaultMix={RET_DEFAULT_MIX}
        onRegisterAccountMix={onRegisterAccountMix}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add roth conversion/i }));
    const growthSelect = screen
      .getByRole("option", { name: /Plan default/i })
      .closest("select") as HTMLSelectElement;
    fireEvent.change(growthSelect, { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Roth IRA" }));

    expect(
      onChange.mock.calls.map((c) => c[0]).some((m) => m.kind === "account-upsert"),
    ).toBe(true);
    expect(onRegisterAccountMix).not.toHaveBeenCalled();
  });

  it("offers Estate planning as a catalog card only when baseClientData is provided", () => {
    const base = {
      client: { spouseDob: null }, accounts: [], entities: [], externalBeneficiaries: [],
      incomes: [], expenses: {}, savingsRules: [], liabilities: [], gifts: [], giftEvents: [],
      taxYearRows: [], planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    } as unknown as ClientData;

    const { rerender } = render(
      <SolverTechniquesTab {...baseProps} workingTree={tree([])} onChange={vi.fn()} />,
    );
    // No estate props → the estate card is absent entirely.
    expect(screen.queryByRole("button", { name: /add estate planning/i })).toBeNull();

    rerender(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={base}
        baseClientData={base}
        baseGifts={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add estate planning/i })).toBeInTheDocument();
    // Nothing configured yet, so the card is the only affordance — no row.
    expect(screen.queryByRole("button", { name: /edit estate planning/i })).toBeNull();
  });

  it("opens the estate editor from its catalog card", () => {
    const base = {
      client: { spouseDob: null }, accounts: [], entities: [], externalBeneficiaries: [],
      incomes: [], expenses: {}, savingsRules: [], liabilities: [], gifts: [], giftEvents: [],
      taxYearRows: [], planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    } as unknown as ClientData;
    const onEstateOpen = vi.fn();

    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={base}
        baseClientData={base}
        baseGifts={[]}
        onChange={vi.fn()}
        onEstateOpen={onEstateOpen}
      />,
    );
    // The editor body is closed to start with.
    expect(screen.queryByText("Revocable Living Trust")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add estate planning/i }));

    expect(screen.getByText("Revocable Living Trust")).toBeInTheDocument();
    // The workspace swings the right pane to the Estate report alongside it.
    expect(onEstateOpen).toHaveBeenCalled();
  });

  it("counts a scenario's techniques on the matching catalog card", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}
        workingTree={tree([rc, { ...rc, id: "rc-2", name: "Second Conv" }], [at])}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add Roth conversion (2 in this scenario)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Asset transaction (1 in this scenario)" }),
    ).toBeInTheDocument();
    // A kind with none configured carries no count.
    expect(screen.getByRole("button", { name: "Add Relocation" })).toBeInTheDocument();
  });

  it("labels each row with its technique kind, since the list mixes kinds", () => {
    render(
      <SolverTechniquesTab {...baseProps} workingTree={tree([rc], [at])} onChange={vi.fn()} />,
    );
    // The kind prefixes the summary line — "Existing Conv" alone doesn't say
    // what kind of technique it is once the sections are gone. The row uses the
    // compact form; the catalog card keeps the full noun.
    expect(screen.getByText("Roth ·")).toBeInTheDocument();
    expect(screen.getByText("Asset ·")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add roth conversion/i })).toBeInTheDocument();
  });

  it("sinks switched-off techniques below the in-use ones across every kind", () => {
    render(
      <SolverTechniquesTab
        {...baseProps}
        // Input order deliberately puts the switched-off Roth first, and the
        // asset transaction after it — a per-kind sort would leave it there.
        workingTree={tree([{ ...rc, id: "rc-off", name: "Off Conv", enabled: false }], [at])}
        onChange={vi.fn()}
      />,
    );
    expect(switchLabels()).toEqual([
      "Include Lake house in projection",
      "Include Off Conv in projection",
    ]);
  });
});
