// Unit tests for the Solver change-editor server action. Mocks at the lib
// boundary, like the promote route's test: the edit gate
// (`requireClientEditAccess`) and the scenario scope
// (`assertScenarioRouteScope`) have their own tests; what's under test here is
// that the action consults both, refuses before any loader runs, and hands the
// client ONLY the view props.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/scenario/route-scope", () => ({ assertScenarioRouteScope: vi.fn() }));
vi.mock("@/app/(app)/clients/[id]/details/income-expenses/load-view-props", () => ({
  loadIncomeExpensesViewProps: vi.fn(),
}));
vi.mock("@/app/(app)/clients/[id]/details/net-worth/load-view-props", () => ({
  loadNetWorthViewProps: vi.fn(),
}));
vi.mock("@/app/(app)/clients/[id]/details/techniques/load-view-props", () => ({
  loadTechniquesViewProps: vi.fn(),
}));
vi.mock("@/app/(app)/clients/[id]/details/family/load-view-props", () => ({
  loadFamilyViewProps: vi.fn(),
}));
vi.mock("@/app/(app)/clients/[id]/details/wills/load-view-props", () => ({
  loadWillsViewProps: vi.fn(),
}));
vi.mock("@/app/(app)/clients/[id]/details/assumptions/load-view-props", () => ({
  loadAssumptionsViewProps: vi.fn(),
}));
vi.mock("@/app/(app)/clients/[id]/details/insurance/load-view-props", () => ({
  loadInsuranceViewProps: vi.fn(),
}));

import { loadChangeEditorProps } from "../change-editor-actions";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import { loadIncomeExpensesViewProps } from "@/app/(app)/clients/[id]/details/income-expenses/load-view-props";
import { loadNetWorthViewProps } from "@/app/(app)/clients/[id]/details/net-worth/load-view-props";
import { loadTechniquesViewProps } from "@/app/(app)/clients/[id]/details/techniques/load-view-props";
import { loadFamilyViewProps } from "@/app/(app)/clients/[id]/details/family/load-view-props";
import { loadWillsViewProps } from "@/app/(app)/clients/[id]/details/wills/load-view-props";
import { loadAssumptionsViewProps } from "@/app/(app)/clients/[id]/details/assumptions/load-view-props";
import { loadInsuranceViewProps } from "@/app/(app)/clients/[id]/details/insurance/load-view-props";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const SCENARIO_ID = "00000000-0000-4000-8000-000000000002";
const FIRM_ID = "firm_owning";

const loaders = [
  loadIncomeExpensesViewProps,
  loadNetWorthViewProps,
  loadTechniquesViewProps,
  loadFamilyViewProps,
  loadWillsViewProps,
  loadAssumptionsViewProps,
  loadInsuranceViewProps,
];

const okScope = (overrides: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  scenario: { id: SCENARIO_ID, clientId: CLIENT_ID, name: "Retire at 62", isBaseCase: false, ...overrides },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    client: { id: CLIENT_ID },
    firmId: FIRM_ID,
    access: "own",
  } as never);
  vi.mocked(assertScenarioRouteScope).mockResolvedValue(okScope() as never);
});

function expectNoLoaderCalled() {
  for (const loader of loaders) expect(loader).not.toHaveBeenCalled();
}

describe("loadChangeEditorProps — refusals", () => {
  it("rejects a view-only caller before touching the scenario or any loader", async () => {
    vi.mocked(requireClientEditAccess).mockRejectedValue(new Error("Edit access required"));

    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "net-worth")).rejects.toThrow(
      "Edit access required",
    );
    expect(requireClientEditAccess).toHaveBeenCalledWith(CLIENT_ID);
    expect(assertScenarioRouteScope).not.toHaveBeenCalled();
    expectNoLoaderCalled();
  });

  it("rejects a scenario that isn't this client's (scope miss)", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue({
      kind: "miss",
      response: NextResponse.json({ error: "Scenario not found" }, { status: 404 }),
    } as never);

    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "family")).rejects.toThrow();
    // Scoped against the OWNING firm from the edit gate, as the scenario routes do.
    expect(assertScenarioRouteScope).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, FIRM_ID);
    expectNoLoaderCalled();
  });

  it("rejects the base case", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue(okScope({ isBaseCase: true }) as never);

    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "techniques")).rejects.toThrow();
    expectNoLoaderCalled();
  });

  it("rejects a page it doesn't open, before any access check", async () => {
    await expect(
      loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "nonsense" as never),
    ).rejects.toThrow();
    expect(requireClientEditAccess).not.toHaveBeenCalled();
    expectNoLoaderCalled();
  });

  it("rejects a malformed scenario id, before any access check", async () => {
    await expect(loadChangeEditorProps(CLIENT_ID, "base", "wills")).rejects.toThrow();
    expect(requireClientEditAccess).not.toHaveBeenCalled();
    expectNoLoaderCalled();
  });

  it("rejects when the page's loader finds no base case", async () => {
    vi.mocked(loadIncomeExpensesViewProps).mockResolvedValue({ status: "no-base-case" });

    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "income-expenses")).rejects.toThrow();
  });
});

describe("loadChangeEditorProps — assumptions and insurance", () => {
  it("assumptions → { page, props } from the existing loader, called with the scenario id", async () => {
    const props = { clientId: CLIENT_ID, marker: "assumptions" };
    vi.mocked(loadAssumptionsViewProps).mockResolvedValue({ status: "ok", props } as never);

    const result = await loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "assumptions");

    expect(result).toEqual({ page: "assumptions", props });
    expect(loadAssumptionsViewProps).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID);
  });

  it("assumptions rejects when the loader finds no plan settings", async () => {
    vi.mocked(loadAssumptionsViewProps).mockResolvedValue({ status: "no-plan-settings" });
    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "assumptions")).rejects.toThrow();
  });

  it("insurance → both panels' props: the life-policy panel's and the disability panel's", async () => {
    const props = { clientId: CLIENT_ID, marker: "insurance" };
    const disabilityProps = { clientId: CLIENT_ID, marker: "disability" };
    vi.mocked(loadInsuranceViewProps).mockResolvedValue({
      status: "ok",
      props,
      disabilityProps,
    } as never);

    const result = await loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "insurance");

    expect(result).toEqual({ page: "insurance", props, disabilityProps });
    expect(requireClientEditAccess).toHaveBeenCalledWith(CLIENT_ID);
    expect(loadInsuranceViewProps).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID);
  });

  it("insurance rejects when the plan has no base case", async () => {
    vi.mocked(loadInsuranceViewProps).mockResolvedValue({ status: "no-base-case" });
    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "insurance")).rejects.toThrow();
  });

  it("insurance on the base case is refused before any loader runs", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue(okScope({ isBaseCase: true }) as never);
    await expect(loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "insurance")).rejects.toThrow(
      "The base case has no changes to edit",
    );
    expectNoLoaderCalled();
  });
});

describe("loadChangeEditorProps — happy path returns only the view props", () => {
  it.each([
    ["income-expenses", loadIncomeExpensesViewProps],
    ["techniques", loadTechniquesViewProps],
    ["wills", loadWillsViewProps],
  ] as const)("%s → { page, props } from its loader, called with the scenario id", async (page, loader) => {
    const props = { clientId: CLIENT_ID, marker: page };
    vi.mocked(loader).mockResolvedValue({ status: "ok", props } as never);

    const result = await loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, page);

    expect(result).toEqual({ page, props });
    expect(loader).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID);
    for (const other of loaders) if (other !== loader) expect(other).not.toHaveBeenCalled();
  });

  it("net-worth drops the page banner's defaultGrowthWarning", async () => {
    const props = { clientId: CLIENT_ID, accounts: [], liabilities: [] };
    vi.mocked(loadNetWorthViewProps).mockResolvedValue({
      status: "ok",
      props,
      defaultGrowthWarning: { count: 3 },
    } as never);

    const result = await loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "net-worth");

    expect(result).toEqual({ page: "net-worth", props });
    expect(loadNetWorthViewProps).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID);
  });

  it("family drops the loader's firmId", async () => {
    const props = { clientId: CLIENT_ID, scenarioId: SCENARIO_ID };
    vi.mocked(loadFamilyViewProps).mockResolvedValue({ props, firmId: FIRM_ID } as never);

    const result = await loadChangeEditorProps(CLIENT_ID, SCENARIO_ID, "family");

    expect(result).toEqual({ page: "family", props });
    expect(loadFamilyViewProps).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID);
  });
});
