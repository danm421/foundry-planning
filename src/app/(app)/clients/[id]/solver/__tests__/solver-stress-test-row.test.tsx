// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";
import type { ClientInfo } from "@/engine/types";
import { StressTestRow, type StressScenarioContext } from "../solver-stress-test-row";
import { PercentField, YearField } from "../solver-stress-fields";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ID = STRESS_TEST_IDS["market-crash"];
const crash = { kind: "market-crash" as const, year: 2027, drawdownPct: 0.3 };
const client = { firstName: "John", spouseName: "Jane Smith" } as ClientInfo;

function ctx(over: Partial<StressScenarioContext> = {}): StressScenarioContext {
  return {
    clientId: "c1", scenarioId: "s1", scenarioName: "Bear case", client,
    onChange: vi.fn(), onResetField: vi.fn(), onSaved: vi.fn(), ...over,
  };
}

function saved(enabled: boolean): ChangesPanelChange {
  return {
    id: "chg-1", scenarioId: "s1", opType: "add", targetKind: "stress_test", targetId: ID,
    payload: { ...crash, id: ID, name: "Market crash — 30% in 2027" },
    toggleGroupId: null, orderIndex: 0, updatedAt: "2026-10-03T00:00:00Z", enabled, label: null,
  };
}

function Row(p: {
  c?: StressScenarioContext;
  saved?: ChangesPanelChange | null;
  draft?: typeof crash | null;
  disabled?: boolean;
}) {
  return (
    <StressTestRow
      kind="market-crash"
      label="Market crash"
      hint="One-time drawdown."
      disabled={p.disabled}
      draft={p.draft === undefined ? crash : p.draft}
      defaults={crash}
      saved={p.saved ?? null}
      ctx={p.c ?? ctx()}
    >
      {(params, commit) => (
        <div>
          <PercentField label="Drawdown" value={params.drawdownPct} onCommit={(d) => commit({ ...params, drawdownPct: d })} />
          <YearField label="Year" value={params.year} onCommit={(year) => commit({ ...params, year })} />
        </div>
      )}
    </StressTestRow>
  );
}

const okFetch = () =>
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
const box = () => screen.getByRole("checkbox", { name: /market crash/i }) as HTMLInputElement;

describe("StressTestRow — draft", () => {
  it("on the base case, Add as change is disabled and says why inline", () => {
    render(<Row c={ctx({ scenarioId: null, scenarioName: null })} />);
    expect((screen.getByRole("button", { name: "Add as change" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pick or create a scenario first. A saved stress test lives in a scenario.")).toBeTruthy();
  });

  it("Add as change POSTs the whole stressor with its fixed id and name, then refreshes", async () => {
    const fetchMock = okFetch();
    const c = ctx();
    render(<Row c={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Add as change" }));
    await waitFor(() => expect(c.onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/c1/scenarios/s1/changes");
    expect(JSON.parse(init!.body as string)).toEqual({
      op: "add", targetKind: "stress_test",
      entity: { ...crash, id: ID, name: "Market crash — 30% in 2027" },
    });
  });

  it("the checkbox drives the draft: on pushes the defaults, off clears the draft key", () => {
    const c = ctx();
    const { rerender } = render(<Row c={c} draft={null} />);
    fireEvent.click(box());
    expect(c.onChange).toHaveBeenCalledWith({ kind: "stress-market-crash", year: 2027, drawdownPct: 0.3 });
    rerender(<Row c={c} />);
    fireEvent.click(box());
    expect(c.onResetField).toHaveBeenCalledWith(["stress-market-crash"]);
  });
});

describe("StressTestRow — saved", () => {
  it("saved and on: the box is ticked, and unticking PATCHes the change off", async () => {
    const fetchMock = okFetch();
    const c = ctx();
    render(<Row c={c} saved={saved(true)} />);
    expect(box().checked).toBe(true);
    expect(screen.getByText("Saved in Bear case.")).toBeTruthy();
    fireEvent.click(box());
    await waitFor(() => expect(c.onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/c1/scenarios/s1/changes/chg-1");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({ enabled: false }) });
  });

  it("editing a saved field re-saves the whole stressor with a fresh name", async () => {
    const fetchMock = okFetch();
    render(<Row saved={saved(true)} />);
    const input = screen.getByLabelText(/drawdown/i);
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.blur(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).entity).toEqual({
      ...crash, drawdownPct: 0.4, id: ID, name: "Market crash — 40% in 2027",
    });
  });

  it("blurring a saved field without changing it sends nothing", () => {
    const fetchMock = okFetch();
    render(<Row saved={saved(true)} />);
    fireEvent.blur(screen.getByLabelText(/drawdown/i));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saved and off: collapsed with its status line, and ticking PATCHes it on", async () => {
    const fetchMock = okFetch();
    render(<Row saved={saved(false)} draft={null} />);
    expect(box().checked).toBe(false);
    expect(screen.queryByLabelText(/drawdown/i)).toBeNull();
    expect(screen.getByText("Saved in Bear case, switched off.")).toBeTruthy();
    fireEvent.click(box());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ enabled: true }) });
  });

  it("saved-off row warns when an older combined change still applies it", () => {
    render(<Row saved={saved(false)} draft={crash} />);
    expect(screen.getByText("Still applied by an older combined change on the Changes tab.")).toBeTruthy();
  });

  it("Remove from scenario DELETEs the stressor's add row", async () => {
    const fetchMock = okFetch();
    render(<Row saved={saved(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from scenario" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/clients/c1/scenarios/s1/changes?kind=stress_test&target=${ID}&op=add`);
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("a failed switch-off shows the alert and keeps the box ticked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const c = ctx();
    render(<Row c={c} saved={saved(true)} />);
    fireEvent.click(box());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Couldn't save. Try again.");
    expect(c.onSaved).not.toHaveBeenCalled();
    expect(box().checked).toBe(true);
  });

  it("view-only access disables the switch, the fields and Remove", () => {
    render(
      <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
        <Row saved={saved(true)} />
      </ClientAccessProvider>,
    );
    expect(box().disabled).toBe(true);
    // The fields are disabled through their <fieldset>; an input's own
    // `.disabled` property does not reflect an ancestor's.
    expect(screen.getByLabelText(/drawdown/i).closest("fieldset")!.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove from scenario" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a disabled row (flat tax mode) that is saved still offers Remove", () => {
    render(<Row saved={saved(true)} disabled />);
    expect(box().disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Remove from scenario" })).toBeTruthy();
  });
});
