// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { SolverChangesTab } from "../solver-changes-tab";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { PanelData } from "@/lib/scenario/load-panel-data";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import type { ClientData } from "@/engine/types";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { useScenarioWriteListener } from "@/hooks/scenario-write-listener";

const { routerPushMock, nav, clientScenarios } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  // The URL the scenario picker reads; a test sets the query it starts on.
  nav: { search: "" },
  // What the layout hands the page as the client's scenarios. Empty by
  // default, which keeps the picker out of every test that doesn't set it.
  clientScenarios: [] as { id: string; name: string; isBaseCase: boolean }[],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: routerPushMock }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/clients/c1/solver",
}));

const TARGET_ID_FOR_STUB = "11111111-2222-3333-4444-555555555555";
const { loadChangeEditorPropsMock, makeStubView, openCreateMock, notYetReady } = vi.hoisted(() => ({
  openCreateMock: vi.fn(),
  // Mutable so a test can open a type the catalog still holds back.
  notYetReady: new Set<string>(),
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
          <button
            type="button"
            onClick={() => onWrite?.({ targetKind: "plan_settings", targetId: "client-uuid", op: "edit" })}
          >
            stub write settings
          </button>
          <button
            type="button"
            onClick={() => onWrite?.({ targetKind: "client", targetId: "client-uuid", op: "edit" })}
          >
            stub write client
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
vi.mock("@/lib/scenario/plan-detail-catalog", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/scenario/plan-detail-catalog")>();
  return { ...orig, NOT_YET_READY: notYetReady };
});
vi.mock("@/components/wills-panel", () => ({ default: makeStubView("wills") }));
vi.mock("@/components/insurance-panel", () => ({ default: makeStubView("insurance") }));
vi.mock("@/components/disability-panel", () => ({ default: makeStubView("disability") }));
vi.mock("@/components/ltc-panel", () => ({ default: makeStubView("ltc") }));
vi.mock("@/app/(app)/clients/[id]/details/assumptions/assumptions-client", () => ({
  default: makeStubView("assumptions"),
}));
vi.mock("@/components/scenario/scenario-mode-wrapper", () => ({
  useScenarioModeUI: () => ({ openCreate: openCreateMock }),
  useClientScenarios: () => clientScenarios,
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

const emptyTree = (over: Record<string, unknown> = {}) =>
  ({ accounts: [], transfers: [], rothConversions: [], savingsRules: [], ...over }) as unknown as ClientData;

function renderTab(
  changes: ChangesPanelChange[],
  {
    permission = "edit" as "edit" | "view",
    toggleGroups = [] as ToggleGroup[],
    inventory = [] as InventoryItem[],
    planTree = emptyTree(),
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
        planTree={planTree}
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

/** The confirm dialog's own Remove — the toolbar button is "Remove" too. */
const confirmRemove = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" });

/** Opens the Edit or Remove picker, expands the item's category, and picks it. */
function pickFromCategory(verb: "Edit" | "Remove", category: string, name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: verb }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${category} \\(`) }));
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  loadChangeEditorPropsMock.mockReset();
  openCreateMock.mockReset();
  routerPushMock.mockReset();
  nav.search = "";
  clientScenarios.length = 0;
  notYetReady.clear();
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
        planTree={emptyTree()}
        willGrantors={[]}
        onOpenSolverTab={vi.fn()}
        onTargetsWritten={vi.fn()}
      />,
    );
    expect(screen.getByText("Pick a scenario to see its changes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^group$/i })).not.toBeInTheDocument();
  });
});

describe("SolverChangesTab — scenario picker", () => {
  const SCENARIOS = [
    { id: "base-id", name: "Base case", isBaseCase: true },
    { id: SCENARIO_ID, name: "Retire at 62", isBaseCase: false },
    { id: "s-2", name: "Sell the house", isBaseCase: false },
    { id: "s-orphan", name: "writer-test-1234", isBaseCase: false },
  ];
  const picker = () => screen.getByRole("combobox", { name: "Scenario" });
  const renderBase = () =>
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <SolverChangesTab
          clientId={CLIENT_ID}
          panel={null}
          inventory={[]}
          planTree={emptyTree()}
          willGrantors={[]}
          onOpenSolverTab={vi.fn()}
          onTargetsWritten={vi.fn()}
        />
      </ClientAccessProvider>,
    );

  it("switches to another scenario and stays on the Changes tab", () => {
    clientScenarios.push(...SCENARIOS);
    nav.search = `scenario=${SCENARIO_ID}&tab=changes`;
    renderTab([makeChange()]);
    expect(picker()).toHaveValue(SCENARIO_ID);
    expect(within(picker()).queryByRole("option", { name: "writer-test-1234" })).not.toBeInTheDocument();

    fireEvent.change(picker(), { target: { value: "s-2" } });
    expect(routerPushMock).toHaveBeenCalledWith("/clients/c1/solver?scenario=s-2&tab=changes");
    // The pick holds while the new scenario loads, rather than snapping back.
    expect(picker()).toHaveValue("s-2");
  });

  it("picking Base case clears the scenario", () => {
    clientScenarios.push(...SCENARIOS);
    nav.search = `scenario=${SCENARIO_ID}&tab=changes`;
    renderTab([makeChange()]);
    fireEvent.change(picker(), { target: { value: "base" } });
    expect(routerPushMock).toHaveBeenCalledWith("/clients/c1/solver?tab=changes");
  });

  it("the base case's empty state offers the picker too", () => {
    clientScenarios.push(...SCENARIOS);
    nav.search = "tab=changes";
    renderBase();
    expect(picker()).toHaveValue("base");
    fireEvent.change(picker(), { target: { value: SCENARIO_ID } });
    expect(routerPushMock).toHaveBeenCalledWith(`/clients/c1/solver?tab=changes&scenario=${SCENARIO_ID}`);
  });

  it("view-only advisors can switch scenarios too", () => {
    clientScenarios.push(...SCENARIOS);
    nav.search = `scenario=${SCENARIO_ID}`;
    renderTab([makeChange()], { permission: "view" });
    expect(picker()).toBeInTheDocument();
  });

  it("is left out when the client has no scenario besides the base case", () => {
    clientScenarios.push(SCENARIOS[0], SCENARIOS[3]);
    renderBase();
    expect(screen.queryByRole("combobox", { name: "Scenario" })).not.toBeInTheDocument();
  });
});

describe("SolverChangesTab — which rows open", () => {
  it("a change with an editor is openable", () => {
    renderTab([makeChange()]);
    expect(screen.getByRole("button", { name: "Edit Side income" })).toBeInTheDocument();
  });

  // Browser pass C read a missing pencil on a Solver-added business and whole
  // life policy as "can't open". Both are `account` adds and both open (the
  // title is the Edit button), and every row renders the Rename pencil — it is
  // only revealed on hover/focus, so a screenshot shows it on the hovered row.
  it("Solver-added business, its cash account and a whole-life policy are all openable, with a pencil", () => {
    renderTab([
      makeChange({ id: "c-biz", targetId: "biz-1", targetKind: "account", payload: { name: "ZZ Biz C", category: "business" } }),
      makeChange({
        id: "c-cash",
        targetId: "cash-1",
        targetKind: "account",
        payload: { name: "ZZ Biz C — Cash", category: "cash", parentAccountId: "biz-1" },
      }),
      makeChange({ id: "c-wl", targetId: "wl-1", targetKind: "account", payload: { name: "ZZ Whole Life", category: "life_insurance" } }),
      makeChange({ id: "c-ltd", targetId: "ltd-1", targetKind: "disability_policy", payload: { name: "ZZ LTD Policy" } }),
    ]);
    for (const name of ["ZZ Biz C", "ZZ Biz C — Cash", "ZZ Whole Life", "ZZ LTD Policy"]) {
      expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "Rename change" })).toHaveLength(4);
  });

  it("a removed change has nothing to open", () => {
    renderTab([makeChange({ opType: "remove" })]);
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("a plan_settings change with an empty payload has no editor and is not openable", () => {
    renderTab([makeChange({ opType: "edit", targetKind: "plan_settings", payload: {} })]);
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
    loadChangeEditorPropsMock.mockResolvedValue({ page, props: { clientId: CLIENT_ID, accounts: [] } });
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

  it("a life-insurance account change opens on the Insurance page, not Net Worth", async () => {
    loadChangeEditorPropsMock.mockImplementation(async (_c: string, _s: string, page: string) =>
      page === "insurance"
        ? { page: "insurance", props: { clientId: CLIENT_ID } }
        : { page: "net-worth", props: { clientId: CLIENT_ID, accounts: [{ id: TARGET_ID, category: "life_insurance" }] } },
    );
    renderTab([makeChange({ targetKind: "account" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));

    const view = await screen.findByTestId("view-insurance");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ kind: "account", id: TARGET_ID });
    expect(loadChangeEditorPropsMock.mock.calls.map((c) => c[2])).toEqual(["net-worth", "insurance"]);
    expect(screen.queryByTestId("view-net-worth")).not.toBeInTheDocument();
  });

  it("a disability change opens the disability panel on the Insurance page's props", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({
      page: "insurance",
      props: { clientId: CLIENT_ID },
      disabilityProps: { clientId: CLIENT_ID },
    });
    renderTab([makeChange({ targetKind: "disability_policy" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));

    const view = await screen.findByTestId("view-disability");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ kind: "disability_policy", id: TARGET_ID });
    expect(loadChangeEditorPropsMock.mock.calls.map((c) => c[2])).toEqual(["insurance"]);
    expect(screen.queryByTestId("view-insurance")).not.toBeInTheDocument();
  });

  it("an LTC change opens the LTC panel on the Insurance page's props", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({
      page: "insurance",
      props: { clientId: CLIENT_ID },
      disabilityProps: { clientId: CLIENT_ID },
      ltcProps: { clientId: CLIENT_ID },
    });
    renderTab([makeChange({ targetKind: "ltc_policy" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    const view = await screen.findByTestId("view-ltc");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ kind: "ltc_policy", id: TARGET_ID });
    expect(screen.queryByTestId("view-insurance")).not.toBeInTheDocument();
  });

  it("an unavailable life policy links to the Insurance page in this scenario", async () => {
    loadChangeEditorPropsMock.mockImplementation(async (_c: string, _s: string, page: string) =>
      page === "insurance"
        ? { page: "insurance", props: { clientId: CLIENT_ID } }
        : { page: "net-worth", props: { clientId: CLIENT_ID, accounts: [{ id: TARGET_ID, category: "life_insurance" }] } },
    );
    renderTab([makeChange({ targetKind: "account" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    await screen.findByTestId("view-insurance");

    fireEvent.click(screen.getByRole("button", { name: "stub unavailable" }));

    expect(screen.getByRole("link", { name: "Edit this on the Details page" })).toHaveAttribute(
      "href",
      `/clients/${CLIENT_ID}/details/insurance?scenario=${SCENARIO_ID}`,
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

  it.each(["client_deduction", "client_tax_adjustment", "withdrawal_strategy"] as const)(
    "a %s change opens the Assumptions editor in place",
    async (targetKind) => {
      loadChangeEditorPropsMock.mockResolvedValue({ page: "assumptions", props: { clientId: CLIENT_ID } });
      renderTab([makeChange({ targetKind, payload: { name: "Charity" } })]);

      fireEvent.click(screen.getByRole("button", { name: /^Edit / }));

      const view = await screen.findByTestId("view-assumptions");
      expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ kind: targetKind, id: TARGET_ID });
      expect(loadChangeEditorPropsMock).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, "assumptions");
    },
  );

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

  it("the unsupported message can be dismissed", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "net-worth", props: { clientId: CLIENT_ID, accounts: [] } });
    renderTab([makeChange({ targetKind: "account" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit / }));
    await screen.findByTestId("view-net-worth");
    fireEvent.click(screen.getByRole("button", { name: "stub unsupported" }));
    expect(screen.getByText(UNSUPPORTED_MESSAGE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText(UNSUPPORTED_MESSAGE)).not.toBeInTheDocument();
  });

  // No kind is "unsupported" at the resolver any more; a view still reports it
  // (a gift series' editor, a trust create), and the host explains.
  it("opening another change replaces the fallback message", async () => {
    loadChangeEditorPropsMock.mockImplementation(async (_client, _scenario, page) => ({
      page,
      props: { clientId: CLIENT_ID, accounts: [] },
    }));
    renderTab([
      makeChange(),
      makeChange({ id: "c-2", targetKind: "account", payload: { name: "Brokerage" } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Brokerage" }));
    await screen.findByTestId("view-net-worth");
    fireEvent.click(screen.getByRole("button", { name: "stub unsupported" }));
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
    fireEvent.click(screen.getByRole("button", { name: /Salary/ }));
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
    pickFromCategory("Remove", "Income", /Side income/);
    expect(
      screen.getByText("Remove Side income from Retire early? You can switch it back on in the list below."),
    ).toBeInTheDocument();
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
    fireEvent.click(confirmRemove());
    const view = await screen.findByTestId("view-income-expenses");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ intent: "delete", kind: "income", id: TARGET_ID });
  });

  it("cancelling the delete confirm mounts nothing", () => {
    renderTab([], { inventory: INVENTORY });
    pickFromCategory("Remove", "Income", /Side income/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/^Remove Side income/)).not.toBeInTheDocument();
    expect(loadChangeEditorPropsMock).not.toHaveBeenCalled();
  });

  describe("delete confirm lists what the scenario remove cascades through", () => {
    const ACCOUNT_INV = [
      item({ typeKey: "account", id: "a-1", label: "Joint brokerage" }),
      item({ typeKey: "savings_rule", id: "r-1", label: "401(k) — Pat" }),
    ];
    const pickAccount = () => {
      pickFromCategory("Remove", "Account", /Joint brokerage/);
    };

    it("an account with a savings rule and a Roth conversion sourced only from it lists both", () => {
      renderTab([], {
        inventory: ACCOUNT_INV,
        planTree: emptyTree({
          accounts: [{ id: "a-1" }],
          savingsRules: [{ id: "r-1", accountId: "a-1" }, { id: "r-2", accountId: "a-other" }],
          rothConversions: [
            { id: "rc-1", name: "Ladder", sourceAccountIds: ["a-1"], destinationAccountId: "a-roth" },
            { id: "rc-2", name: "Spread", sourceAccountIds: ["a-1", "a-2"], destinationAccountId: "a-roth" },
          ],
        }),
      });
      pickAccount();
      expect(screen.getByText(/Savings rule · 401\(k\) — Pat/)).toBeInTheDocument();
      expect(screen.getByText(/Roth Conversion · Ladder/)).toBeInTheDocument();
      // Still has another source, so it survives.
      expect(screen.queryByText(/Spread/)).not.toBeInTheDocument();
      expect(screen.getByText(/also remove 2 linked items/)).toBeInTheDocument();
    });

    it("a transfer touching the account is listed; the source tree is left untouched", () => {
      const tree = emptyTree({
        accounts: [{ id: "a-1" }],
        transfers: [{ id: "t-1", name: "Annual sweep", sourceAccountId: "a-1", targetAccountId: "a-2" }],
      });
      renderTab([], { inventory: ACCOUNT_INV, planTree: tree });
      pickAccount();
      expect(screen.getByText(/Transfer · Annual sweep/)).toBeInTheDocument();
      expect(tree.transfers).toHaveLength(1);
    });

    it("an account the scenario added (it exists only in the scenario tree) works the same", () => {
      renderTab([], {
        inventory: ACCOUNT_INV,
        planTree: emptyTree({
          accounts: [{ id: "a-1", name: "Scenario-only" }],
          transfers: [{ id: "t-9", name: "Fund it", sourceAccountId: "a-2", targetAccountId: "a-1" }],
        }),
      });
      pickAccount();
      expect(screen.getByText(/Transfer · Fund it/)).toBeInTheDocument();
    });

    it("an account with no dependents shows no list, and never calls the network", () => {
      renderTab([], { inventory: ACCOUNT_INV, planTree: emptyTree({ accounts: [{ id: "a-1" }] }) });
      pickAccount();
      expect(screen.queryByText(/linked item/)).not.toBeInTheDocument();
      expect(confirmRemove()).toBeEnabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("a non-account delete lists nothing", () => {
    renderTab([], { inventory: INVENTORY });
    pickFromCategory("Remove", "Income", /Side income/);
    expect(screen.queryByText(/linked item/)).not.toBeInTheDocument();
  });

  it("a delete says Removing in every loading state and never Opening the editor", async () => {
    const load = deferred<unknown>();
    loadChangeEditorPropsMock.mockReturnValue(load.promise);
    renderTab([], { inventory: INVENTORY });
    pickFromCategory("Remove", "Income", /Side income/);
    fireEvent.click(confirmRemove());
    expect(screen.getByRole("status")).toHaveTextContent("Removing Side income…");
    expect(screen.queryByText("Opening the editor…")).not.toBeInTheDocument();
    load.resolve({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    await screen.findByTestId("view-income-expenses");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("Opening the editor…")).not.toBeInTheDocument();
  });

  it("an Assumptions write is re-addressed to the tab the editor opened on", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "assumptions", props: { clientId: CLIENT_ID } });
    const { onTargetsWritten } = renderTab([], {
      inventory: [item({ typeKey: "savings_withdrawals", id: "withdrawal", label: "Savings & withdrawals" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Savings & withdrawals/ }));
    await screen.findByTestId("view-assumptions");
    fireEvent.click(screen.getByRole("button", { name: "stub write settings" }));
    expect(onTargetsWritten).toHaveBeenCalledWith(
      [{ targetKind: "plan_settings", targetId: "withdrawal", op: "edit" }],
      "Savings & withdrawals",
    );
  });

  it("a workplace-coverage client write from the Tax Rates dialog is addressed to that tab", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "assumptions", props: { clientId: CLIENT_ID } });
    const { onTargetsWritten } = renderTab([], {
      inventory: [item({ typeKey: "tax_rates", id: "tax-rates", label: "Tax rates" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Tax rates/ }));
    await screen.findByTestId("view-assumptions");
    fireEvent.click(screen.getByRole("button", { name: "stub write client" }));
    expect(onTargetsWritten).toHaveBeenCalledWith(
      [{ targetKind: "plan_settings", targetId: "tax-rates", op: "edit" }],
      "Tax rates",
    );
  });

  it("a delete shows a status strip while the view runs", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    pickFromCategory("Remove", "Income", /Side income/);
    fireEvent.click(confirmRemove());
    await screen.findByTestId("view-income-expenses");
    expect(screen.getByRole("status")).toHaveTextContent("Removing Side income…");
  });

  it("a failed delete shows an inline error with Dismiss", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "income-expenses", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: INVENTORY });
    pickFromCategory("Remove", "Income", /Side income/);
    fireEvent.click(confirmRemove());
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
    pickFromCategory("Edit", "Income", /Side income/);
    await screen.findByTestId("view-income-expenses");
    fireEvent.click(screen.getByRole("button", { name: "stub write" }));
    expect(onTargetsWritten).toHaveBeenCalledWith(
      [{ targetKind: "income", targetId: TARGET_ID, op: "remove" }],
      "Side income",
    );
  });

  it("editing a trust opens the family view with an edit focus", async () => {
    loadChangeEditorPropsMock.mockResolvedValue({ page: "family", props: { clientId: CLIENT_ID } });
    renderTab([], { inventory: [item({ typeKey: "trust", id: "t1", label: "Family Trust" })] });
    pickFromCategory("Edit", "Trust / entity", /Family Trust/);
    const view = await screen.findByTestId("view-family");
    expect(JSON.parse(view.getAttribute("data-focus")!)).toEqual({ intent: "edit", kind: "entity", id: "t1" });
  });

  it("view-only advisors see no toolbar", () => {
    renderTab([], { permission: "view", inventory: INVENTORY });
    expect(screen.queryByRole("button", { name: "+ Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("the base case shows the disabled toolbar and Create scenario", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <SolverChangesTab
          clientId={CLIENT_ID}
          panel={null}
          inventory={INVENTORY}
          planTree={emptyTree()}
          willGrantors={[]}
          onOpenSolverTab={vi.fn()}
          onTargetsWritten={vi.fn()}
        />
      </ClientAccessProvider>,
    );
    for (const name of ["+ Add", "Edit", "Remove"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText("Add, edit and remove work inside a scenario.")).toBeInTheDocument();
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

describe("SolverChangesTab — LTC event", () => {
  const ltcEvent = {
    id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566",
    name: "Long-term care — John 85–87",
    people: [
      { person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129575, costInflation: 0.05 },
    ],
    livingExpenseCutPct: null,
    homeSale: null,
    includePolicies: true,
  };
  const ltcChange = () =>
    makeChange({ id: "c-ltc", targetKind: "ltc_event", targetId: ltcEvent.id, payload: ltcEvent });

  function renderWithPending(
    onInitialOpenConsumed: () => void,
    initialOpenChangeId: string | null,
    panel: PanelData | null = makePanel({ changes: [ltcChange()] }),
  ) {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <SolverChangesTab
          clientId={CLIENT_ID}
          panel={panel}
          inventory={[]}
          planTree={buildClientData()}
          willGrantors={[]}
          onOpenSolverTab={vi.fn()}
          onTargetsWritten={vi.fn()}
          initialOpenChangeId={initialOpenChangeId}
          onInitialOpenConsumed={onInitialOpenConsumed}
        />
      </ClientAccessProvider>,
    );
  }

  it("a pending change id opens the LTC dialog on arrival and is consumed", () => {
    const consumed = vi.fn();
    renderWithPending(consumed, "c-ltc");
    expect(screen.getByText("Long-term care event")).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it("a pending id for a SWITCHED-OFF change opens nothing and is still consumed", () => {
    const consumed = vi.fn();
    renderWithPending(consumed, "c-ltc", makePanel({ changes: [{ ...ltcChange(), enabled: false }] }));
    expect(screen.queryByText("Long-term care event")).not.toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it("a pending id is consumed even with no scenario panel", () => {
    const consumed = vi.fn();
    renderWithPending(consumed, "c-ltc", null);
    expect(screen.queryByText("Long-term care event")).not.toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it("with nothing pending, no dialog opens and nothing is consumed", () => {
    const consumed = vi.fn();
    renderWithPending(consumed, null);
    expect(screen.queryByText("Long-term care event")).not.toBeInTheDocument();
    expect(consumed).not.toHaveBeenCalled();
  });
});
