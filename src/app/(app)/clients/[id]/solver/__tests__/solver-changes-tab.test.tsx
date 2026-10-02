// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SolverChangesTab } from "../solver-changes-tab";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { PanelData } from "@/lib/scenario/load-panel-data";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import { useScenarioWriteListener } from "@/hooks/scenario-write-listener";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const TARGET_ID_FOR_STUB = "11111111-2222-3333-4444-555555555555";
const { loadChangeEditorPropsMock, makeStubView, openCreateMock } = vi.hoisted(() => ({
  openCreateMock: vi.fn(),
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
      onFocusClose?: (outcome?: "unavailable" | "unsupported" | "failed") => void;
      marker?: string;
    }) {
      const onWrite = useScenarioWriteListener();
      return (
        <div data-testid={`view-${page}`} data-focus={JSON.stringify(focus)} data-marker={marker}>
          <button
            type="button"
            onClick={() => onWrite?.({ targetKind: "income", targetId: TARGET_ID_FOR_STUB, op: "remove" })}
          >
            stub write
          </button>
          <button type="button" onClick={() => onFocusClose?.("failed")}>
            stub failed
          </button>
          <button type="button" onClick={() => onFocusClose?.()}>
            stub close
          </button>
          <button type="button" onClick={() => onFocusClose?.("unavailable")}>
            stub unavailable
          </button>
          <button type="button" onClick={() => onFocusClose?.("unsupported")}>
            stub unsupported
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
vi.mock("@/components/scenario/scenario-mode-wrapper", () => ({
  useScenarioModeUI: () => ({ openCreate: openCreateMock }),
  ScenarioModeWrapper: ({ children }: { children: unknown }) => children,
}));
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const CLIENT_ID = "c1";
const UNSUPPORTED_MESSAGE =
  "This change can't be edited inside a scenario yet. You can still switch it off or delete it here.";
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

const item = (over: Partial<InventoryItem> & Pick<InventoryItem, "typeKey" | "id" | "label">): InventoryItem => ({
  key: `${over.typeKey}:${over.id}`,
  canEdit: true,
  canDelete: true,
  ...over,
});
const INVENTORY: InventoryItem[] = [
  item({ typeKey: "income", id: TARGET_ID, label: "Side income" }),
  item({ typeKey: "income", id: "i-salary", label: "Salary" }),
  item({ typeKey: "account", id: "a-1", label: "Joint brokerage" }),
];

function renderTab(
  changes: ChangesPanelChange[],
  {
    permission = "edit" as "edit" | "view",
    toggleGroups = [] as ToggleGroup[],
    inventory = [] as InventoryItem[],
    panelOverrides = {} as Partial<PanelData>,
  } = {},
) {
  const onOpenSolverTab = vi.fn();
  const onTargetsWritten = vi.fn();
  render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <SolverChangesTab
        clientId={CLIENT_ID}
        panel={makePanel({ changes, toggleGroups, ...panelOverrides })}
        inventory={inventory}
        willGrantors={["client", "spouse"]}
        onOpenSolverTab={onOpenSolverTab}
        onTargetsWritten={onTargetsWritten}
      />
    </ClientAccessProvider>,
  );
  return { onOpenSolverTab, onTargetsWritten };
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
  openCreateMock.mockReset();
  fetchMock.mockReset();
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
    render(
      <SolverChangesTab
        clientId={CLIENT_ID}
        panel={null}
        inventory={[]}
        willGrantors={[]}
        onOpenSolverTab={vi.fn()}
        onTargetsWritten={vi.fn()}
      />,
    );
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
    expect(screen.queryByRole("button", { name: /^(Edit|Open) / })).not.toBeInTheDocument();
  });
});

// Ruling F-M4: a row that jumps to a Solver tab is named "Open …" — it opens
// a tab, not an editor.
describe("SolverChangesTab — Solver-tab jumps", () => {
  it("a stress-test change switches to the Stress tab, no editor load", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({ opType: "edit", targetKind: "plan_settings", payload: { marketShock: { year: 2030 } } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("stress_test");
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  // Ruling F-M2: the Solver folds every plan_settings edit into one row.
  it("a stress lever sharing its row with another setting still opens the Stress tab", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({
        opType: "edit",
        targetKind: "plan_settings",
        payload: { marketShock: { year: 2030 }, surplusSpendPct: { from: 0, to: 0.5 } },
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("stress_test");
  });

  it("a life-expectancy change switches to the Retirement tab", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({ opType: "edit", targetKind: "client", payload: { lifeExpectancy: 95, planEndAge: 95 } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("retirement");
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  it("a planEndYear change switches to the Retirement tab", () => {
    const { onOpenSolverTab } = renderTab([
      makeChange({ opType: "edit", targetKind: "plan_settings", payload: { planEndYear: 2070 } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    expect(onOpenSolverTab).toHaveBeenCalledWith("retirement");
  });

  it("an editor row stays 'Edit …', an unsupported one too (its click explains)", () => {
    renderTab([
      makeChange(),
      makeChange({ id: "c-2", targetKind: "reinvestment", opType: "edit", payload: { name: "Reinvest" } }),
    ]);
    expect(screen.getByRole("button", { name: "Edit Side income" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Reinvest" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open / })).not.toBeInTheDocument();
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

  // Ruling F-I2: an editor known to write the base plan or revert the change
  // inside a scenario gets an explanation, never a link to that same editor.
  it.each([
    ["reinvestment", "edit"],
    ["family_member", "edit"],
    ["external_beneficiary", "add"],
    ["client_deduction", "add"],
    ["client_tax_adjustment", "edit"],
    ["withdrawal_strategy", "edit"],
    ["entity", "edit"],
  ] as const)("a %s %s explains it can't be edited here — no link, no load", (targetKind, opType) => {
    renderTab([makeChange({ targetKind, opType })]);

    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));

    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(UNSUPPORTED_MESSAGE);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(UNSUPPORTED_MESSAGE)).not.toBeInTheDocument();
  });

  it("'unsupported' from the view unmounts it and explains, with no link", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "net-worth", props: { clientId: CLIENT_ID, accounts: [] } });
    renderTab([makeChange({ targetKind: "account" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    await screen.findByTestId("view-net-worth");

    fireEvent.click(screen.getByRole("button", { name: "stub unsupported" }));

    expect(screen.queryByTestId("view-net-worth")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(UNSUPPORTED_MESSAGE);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
    expect(screen.getByText(UNSUPPORTED_MESSAGE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));

    await waitFor(() => expect(screen.queryByText(UNSUPPORTED_MESSAGE)).not.toBeInTheDocument());
    expect(await screen.findByTestId("view-income-expenses")).toBeInTheDocument();
  });
});


describe("SolverChangesTab — Add, Edit and Delete toolbar", () => {
  it("Add → Expense mounts the income-expenses view with a create focus", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Expense" }));
    const view = await screen.findByTestId("view-income-expenses");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ intent: "create", kind: "expense" });
    expect(loadChangeEditorPropsMock).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, "income-expenses");
  });

  it("Add → Account → Retirement carries the variant", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "net-worth", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirement" }));
    const view = await screen.findByTestId("view-net-worth");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({
      intent: "create",
      kind: "account",
      variant: "retirement",
    });
  });

  it("Edit → search → pick mounts an edit focus for that row", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "salary" } });
    fireEvent.click(screen.getByRole("option", { name: /Salary/ }));
    const view = await screen.findByTestId("view-income-expenses");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({
      intent: "edit",
      kind: "income",
      id: "i-salary",
    });
  });

  it("Delete asks first, then mounts a delete focus", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY, panelOverrides: { scenarioName: "Retire early" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Side income/ }));
    expect(
      screen.getByText("Remove Side income from Retire early? You can switch it back on in the list below."),
    ).toBeInTheDocument();
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const view = await screen.findByTestId("view-income-expenses");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ intent: "delete", kind: "income", id: TARGET_ID });
  });

  it("cancelling the delete confirm mounts nothing", () => {
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Side income/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/^Remove Side income/)).not.toBeInTheDocument();
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  it("Delete of an account lists its dependents before confirming", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transfers: [{ id: "t1", name: "Annual sweep" }], rothConversions: [{ id: "r1", name: "Ladder" }] }),
    });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Joint brokerage/ }));
    expect(await screen.findByText(/Annual sweep/)).toBeInTheDocument();
    expect(screen.getByText(/Ladder/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/accounts/a-1/dependents`);
  });

  it("a failed dependents lookup still lets the advisor confirm", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Joint brokerage/ }));
    expect(await screen.findByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("a non-account delete never asks for dependents", () => {
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Side income/ }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a delete shows a status strip while the view runs", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Side income/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByTestId("view-income-expenses");
    expect(screen.getByRole("status")).toHaveTextContent("Removing Side income…");
  });

  it("a failed delete shows an inline error with Dismiss", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("option", { name: /Side income/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByTestId("view-income-expenses");

    fireEvent.click(screen.getByRole("button", { name: "stub failed" }));

    expect(screen.queryByTestId("view-income-expenses")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't remove Side income.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a write the view announces, with the editor's label", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    const { onTargetsWritten } = renderTab([], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("option", { name: /Side income/ }));
    await screen.findByTestId("view-income-expenses");
    fireEvent.click(screen.getByRole("button", { name: "stub write" }));
    expect(onTargetsWritten).toHaveBeenCalledWith(
      [{ targetKind: "income", targetId: TARGET_ID, op: "remove" }],
      "Side income",
    );
  });

  it("editing a trust stays on the explain-only path", () => {
    renderTab([], {
      inventory: [item({ typeKey: "trust", id: "t1", label: "Family Trust" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("option", { name: /Family Trust/ }));
    expect(screen.getByRole("status")).toHaveTextContent(UNSUPPORTED_MESSAGE);
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  it("view-only advisors see no toolbar", () => {
    renderTab([], { permission: "view", inventory: INVENTORY });
    expect(screen.queryByRole("button", { name: "+ Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("the base case shows the disabled toolbar and Create scenario", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <SolverChangesTab
          clientId={CLIENT_ID}
          panel={null}
          inventory={INVENTORY}
          willGrantors={[]}
          onOpenSolverTab={vi.fn()}
          onTargetsWritten={vi.fn()}
        />
      </ClientAccessProvider>,
    );
    for (const name of ["+ Add", "Edit", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText("Add, edit and delete work inside a scenario.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(openCreateMock).toHaveBeenCalledTimes(1);
  });

  it("clicking a change to edit it reports writes with that change's name", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    const { onTargetsWritten } = renderTab([makeChange()], { inventory: INVENTORY });
    fireEvent.click(screen.getByRole("button", { name: "Edit Side income" }));
    await screen.findByTestId("view-income-expenses");
    fireEvent.click(screen.getByRole("button", { name: "stub write" }));
    expect(onTargetsWritten).toHaveBeenCalledTimes(1);
    expect(onTargetsWritten.mock.calls[0][1]).toBe("Side income");
  });
});
