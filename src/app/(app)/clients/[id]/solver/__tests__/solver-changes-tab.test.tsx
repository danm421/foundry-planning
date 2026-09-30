// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SolverChangesTab } from "../solver-changes-tab";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { PanelData } from "@/lib/scenario/load-panel-data";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { ToggleGroup } from "@/engine/scenario/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { loadChangeEditorPropsMock, makeStubView } = vi.hoisted(() => ({
  loadChangeEditorPropsMock: vi.fn(),
  // Light stand-in for a Details view in focus mode: shows the focus it was
  // mounted with and a props marker, and exposes both onFocusClose outcomes.
  // The real views' focus behavior is covered by their own focus tests.
  makeStubView: (page: string) =>
    function StubView({
      focus,
      onFocusClose,
      marker,
    }: {
      focus?: EditorFocus;
      onFocusClose?: (outcome?: "unavailable") => void;
      marker?: string;
    }) {
      return (
        <div data-testid={`view-${page}`} data-focus={JSON.stringify(focus)} data-marker={marker}>
          <button type="button" onClick={() => onFocusClose?.()}>
            stub close
          </button>
          <button type="button" onClick={() => onFocusClose?.("unavailable")}>
            stub unavailable
          </button>
        </div>
      );
    },
}));

vi.mock("../change-editor-actions", () => ({ loadChangeEditorProps: loadChangeEditorPropsMock }));
vi.mock("@/components/income-expenses-view", () => ({ default: makeStubView("income-expenses") }));
vi.mock("@/components/balance-sheet-view", () => ({ default: makeStubView("net-worth") }));
vi.mock("@/components/techniques-view", () => ({ default: makeStubView("techniques") }));
vi.mock("@/components/family-view", () => ({ default: makeStubView("family") }));
vi.mock("@/components/wills-panel", () => ({ default: makeStubView("wills") }));

const CLIENT_ID = "c1";
const SCENARIO_ID = "s-1";
const TARGET_ID = "11111111-2222-3333-4444-555555555555";

function makeChange(overrides: Partial<ChangesPanelChange> = {}): ChangesPanelChange {
  return {
    id: "c-1",
    scenarioId: SCENARIO_ID,
    opType: "add",
    targetKind: "income",
    targetId: TARGET_ID,
    payload: { name: "Side income" },
    toggleGroupId: null,
    orderIndex: 0,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    enabled: true,
    label: null,
    ...overrides,
  };
}

function makePanel(overrides: Partial<PanelData> = {}): PanelData {
  return {
    scenarioId: SCENARIO_ID,
    scenarioName: "Retire at 62",
    changes: [makeChange()],
    toggleGroups: [],
    cascadeWarnings: [],
    targetNames: {},
    ...overrides,
  };
}

function renderTab(
  changes: ChangesPanelChange[],
  {
    permission = "edit" as "edit" | "view",
    toggleGroups = [] as ToggleGroup[],
  } = {},
) {
  const onOpenSolverTab = vi.fn();
  render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <SolverChangesTab
        clientId={CLIENT_ID}
        panel={makePanel({ changes, toggleGroups })}
        onOpenSolverTab={onOpenSolverTab}
      />
    </ClientAccessProvider>,
  );
  return { onOpenSolverTab };
}

function makeGroup(overrides: Partial<ToggleGroup> = {}): ToggleGroup {
  return {
    id: "g-1",
    scenarioId: SCENARIO_ID,
    name: "Roth ladder",
    defaultOn: true,
    requiresGroupId: null,
    orderIndex: 0,
    ...overrides,
  };
}

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  loadChangeEditorPropsMock.mockReset();
});

describe("SolverChangesTab", () => {
  it("renders the embedded ChangesPanel for a scenario", () => {
    renderTab([makeChange()]);
    expect(screen.getByText("Retire at 62")).toBeInTheDocument();
    expect(screen.getByTestId("leaf-row-c-1")).toBeInTheDocument();
    // embedded variant drops the rail's fixed width
    const aside = document.querySelector("aside");
    expect(aside?.className).toContain("w-full");
    expect(aside?.className).not.toContain("w-[360px]");
  });

  it("shows a quiet empty state on the base case (panel === null)", () => {
    render(<SolverChangesTab clientId={CLIENT_ID} panel={null} onOpenSolverTab={vi.fn()} />);
    expect(screen.getByText("Pick a scenario to see its changes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^group$/i })).not.toBeInTheDocument();
  });
});

describe("SolverChangesTab — which rows open", () => {
  it("a change with an editor is openable", () => {
    renderTab([makeChange()]);
    expect(screen.getByRole("button", { name: "Edit Side income" })).toBeInTheDocument();
  });

  it("a removed change has nothing to open", () => {
    renderTab([makeChange({ opType: "remove" })]);
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("a plan_settings change with no editor (not stress, not horizon) is not openable", () => {
    renderTab([
      makeChange({ opType: "edit", targetKind: "plan_settings", payload: { inflationRate: 0.03 } }),
    ]);
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  // Ruling F-C1: the editors load the tree with groups at their saved on/off
  // state, so a change in a switched-off group would open on base values, and
  // saving would delete it or pull it out of its group.
  describe("toggle groups", () => {
    /** Expand every group card so its leaf rows render. */
    function expandGroups() {
      for (const name of [/^Roth ladder/, /^Parent group/]) {
        const card = screen.queryByRole("button", { name });
        if (card) fireEvent.click(card);
      }
    }

    it("a change in a group that is on is openable", () => {
      renderTab([makeChange({ toggleGroupId: "g-1" })], { toggleGroups: [makeGroup()] });
      expandGroups();
      expect(screen.getByRole("button", { name: "Edit Side income" })).toBeInTheDocument();
    });

    it("a change in a group that is off is not openable", () => {
      renderTab([makeChange({ toggleGroupId: "g-1" })], {
        toggleGroups: [makeGroup({ defaultOn: false })],
      });
      expandGroups();
      expect(screen.getByTestId("leaf-row-c-1")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit Side income" })).not.toBeInTheDocument();
    });

    it("a change whose group is on but requires a group that is off is not openable", () => {
      renderTab([makeChange({ toggleGroupId: "g-1" })], {
        toggleGroups: [
          makeGroup({ requiresGroupId: "g-parent" }),
          makeGroup({ id: "g-parent", name: "Parent group", defaultOn: false, orderIndex: 1 }),
        ],
      });
      expandGroups();
      expect(screen.getByTestId("leaf-row-c-1")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit Side income" })).not.toBeInTheDocument();
    });

    it("a change whose group and required parent are both on is openable", () => {
      renderTab([makeChange({ toggleGroupId: "g-1" })], {
        toggleGroups: [
          makeGroup({ requiresGroupId: "g-parent" }),
          makeGroup({ id: "g-parent", name: "Parent group", orderIndex: 1 }),
        ],
      });
      expandGroups();
      expect(screen.getByRole("button", { name: "Edit Side income" })).toBeInTheDocument();
    });
  });

  it("a view-only advisor can open nothing", () => {
    renderTab(
      [
        makeChange(),
        makeChange({ id: "c-2", opType: "edit", targetKind: "plan_settings", payload: { marketShock: {} } }),
      ],
      { permission: "view" },
    );
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });
});

describe("SolverChangesTab — Solver-tab jumps", () => {
  it("a stress-test change switches to the Stress tab, no editor load", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({ opType: "edit", targetKind: "plan_settings", payload: { marketShock: { year: 2030 } } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("stress_test");
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  it("a life-expectancy change switches to the Retirement tab", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({ opType: "edit", targetKind: "client", payload: { lifeExpectancy: 95, planEndAge: 95 } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("retirement");
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  it("a planEndYear change switches to the Retirement tab", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({ opType: "edit", targetKind: "plan_settings", payload: { planEndYear: 2070 } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("retirement");
  });
});

describe("SolverChangesTab — opening a Details editor", () => {
  it("loads the page's props, then mounts its view with the change's focus", async () => {
    const load = deferred<unknown>();
    loadChangeEditorPropsMock.mockReturnValue(load.promise);
    renderTab([makeChange()]);

    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));

    expect(loadChangeEditorPropsMock).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, "income-expenses");
    expect(await screen.findByText("Opening the editor…")).toBeInTheDocument();

    load.resolve({ page: "income-expenses", props: { clientId: CLIENT_ID, marker: "ie-props" } });

    const view = await screen.findByTestId("view-income-expenses");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ kind: "income", id: TARGET_ID });
    expect(view).toHaveAttribute("data-marker", "ie-props");
    expect(screen.queryByText("Opening the editor…")).not.toBeInTheDocument();
  });

  it.each([
    ["account", "net-worth"],
    ["roth_conversion", "techniques"],
    ["entity", "family"],
    ["will", "wills"],
  ] as const)("a %s change opens the %s view", async (targetKind, page) => {
    loadChangeEditorPropsMock.mockResolvedValue({ page, props: { clientId: CLIENT_ID } });
    renderTab([makeChange({ targetKind })]);

    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));

    expect(loadChangeEditorPropsMock).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, page);
    const view = await screen.findByTestId(`view-${page}`);
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ kind: targetKind, id: TARGET_ID });
  });

  it("a normal close unmounts the view and leaves no message", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([makeChange()]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));
    await screen.findByTestId("view-income-expenses");

    fireEvent.click(screen.getByRole("button", { name: "stub close" }));

    expect(screen.queryByTestId("view-income-expenses")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit this on the Details page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("'unavailable' unmounts the view and links to the Details page in this scenario", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([makeChange()]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));
    await screen.findByTestId("view-income-expenses");

    fireEvent.click(screen.getByRole("button", { name: "stub unavailable" }));

    expect(screen.queryByTestId("view-income-expenses")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit this on the Details page" })).toHaveAttribute(
      "href",
      `/clients/${CLIENT_ID}/details/income-expenses?scenario=${SCENARIO_ID}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("link", { name: "Edit this on the Details page" })).not.toBeInTheDocument();
  });

  it("an unavailable life-insurance account links to the Insurance page, not Net Worth", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({
      page: "net-worth",
      props: { clientId: CLIENT_ID, accounts: [{ id: TARGET_ID, category: "life_insurance" }] },
    });
    renderTab([makeChange({ targetKind: "account" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    await screen.findByTestId("view-net-worth");

    fireEvent.click(screen.getByRole("button", { name: "stub unavailable" }));

    expect(screen.getByRole("link", { name: "Edit this on the Details page" })).toHaveAttribute(
      "href",
      `/clients/${CLIENT_ID}/details/insurance?policy=${TARGET_ID}&scenario=${SCENARIO_ID}`,
    );
  });

  it("any other unavailable account links to Net Worth", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({
      page: "net-worth",
      props: { clientId: CLIENT_ID, accounts: [{ id: TARGET_ID, category: "business" }] },
    });
    renderTab([makeChange({ targetKind: "account" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    await screen.findByTestId("view-net-worth");

    fireEvent.click(screen.getByRole("button", { name: "stub unavailable" }));

    expect(screen.getByRole("link", { name: "Edit this on the Details page" })).toHaveAttribute(
      "href",
      `/clients/${CLIENT_ID}/details/net-worth?scenario=${SCENARIO_ID}`,
    );
  });

  it.each([
    ["client_deduction", "deductions"],
    ["client_tax_adjustment", "tax-adjustments"],
    ["withdrawal_strategy", "withdrawal"],
  ] as const)("a %s change links straight to the Assumptions %s tab, no load", (targetKind, tab) => {
    renderTab([makeChange({ targetKind })]);

    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));

    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Edit this on the Details page" })).toHaveAttribute(
      "href",
      `/clients/${CLIENT_ID}/details/assumptions?tab=${tab}&scenario=${SCENARIO_ID}`,
    );
  });

  it("a failed load shows inline, and Try again retries", async () => {
    loadChangeEditorPropsMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([makeChange()]);

    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open this editor.");
    expect(screen.queryByTestId("view-income-expenses")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("view-income-expenses")).toBeInTheDocument();
    expect(loadChangeEditorPropsMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opening another change replaces the fallback message", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([
      makeChange(),
      makeChange({ id: "c-2", targetKind: "client_deduction", payload: { name: "Charity" } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Charity" }));
    expect(screen.getByRole("link", { name: "Edit this on the Details page" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Edit this on the Details page" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId("view-income-expenses")).toBeInTheDocument();
  });
});
