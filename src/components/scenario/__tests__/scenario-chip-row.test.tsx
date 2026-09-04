// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useScenarioState } from "@/hooks/use-scenario-state";
import { useScenarioModeUI } from "@/components/scenario/scenario-mode-wrapper";
import { ScenarioChipRow, type ScenarioChip } from "../scenario-chip-row";

vi.mock("@/hooks/use-scenario-state", () => ({
  useScenarioState: vi.fn(),
}));

vi.mock("@/components/scenario/scenario-mode-wrapper", () => ({
  useScenarioModeUI: vi.fn(),
}));

const refreshSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshSpy, push: vi.fn(), replace: vi.fn() }),
}));

const CLIENT_ID = "client-123";

const SCENARIOS: ScenarioChip[] = [
  { id: "base", name: "Base case", isBaseCase: true },
  { id: "s1", name: "Roth conversion", isBaseCase: false },
  { id: "s2", name: "Early retirement", isBaseCase: false },
];

let setScenarioSpy: ReturnType<typeof vi.fn<(next: string | null) => void>>;
let openCreateSpy: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  setScenarioSpy = vi.fn<(next: string | null) => void>();
  openCreateSpy = vi.fn<() => void>();
  refreshSpy.mockClear();
  vi.mocked(useScenarioState).mockReturnValue({
    scenarioId: null,
    setScenario: setScenarioSpy,
  });
  vi.mocked(useScenarioModeUI).mockReturnValue({ openCreate: openCreateSpy });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The collapsed trigger is the only button carrying aria-expanded. */
function getTrigger() {
  return screen.getByRole("button", { expanded: false });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getTrigger());
}

describe("ScenarioChipRow", () => {
  it("collapses to a single trigger pill showing the active scenario", () => {
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    // No menu rows until opened.
    expect(screen.queryByRole("menu")).toBeNull();
    const trigger = getTrigger();
    // scenarioId is null → base case is the effective active scenario.
    expect(trigger).toHaveAccessibleName("Base case");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  it("opening the menu lists every scenario in order plus + New scenario", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);

    const rows = screen.getAllByRole("menuitemradio");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Base case");
    expect(rows[1].textContent).toContain("Roth conversion");
    expect(rows[2].textContent).toContain("Early retirement");

    expect(
      screen.getByRole("menuitem", { name: /\+ New scenario/ }),
    ).toBeInTheDocument();
  });

  it("marks the base-case row active when scenarioId is null", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);

    const baseRow = screen.getByRole("menuitemradio", { name: /Base case/ });
    expect(baseRow.textContent?.startsWith("● ")).toBe(true);
    expect(baseRow).toHaveAttribute("aria-checked", "true");

    const otherRow = screen.getByRole("menuitemradio", {
      name: /^Roth conversion$/,
    });
    expect(otherRow.textContent?.startsWith("○ ")).toBe(true);
    expect(otherRow).toHaveAttribute("aria-checked", "false");
  });

  it("selecting a non-base row calls setScenario with that id and closes the menu", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("menuitemradio", { name: /^Roth conversion$/ }),
    );
    expect(setScenarioSpy).toHaveBeenCalledTimes(1);
    expect(setScenarioSpy).toHaveBeenCalledWith("s1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selecting the base-case row calls setScenario(null) to clear the URL", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: /Base case/ }));
    expect(setScenarioSpy).toHaveBeenCalledTimes(1);
    expect(setScenarioSpy).toHaveBeenCalledWith(null);
  });

  it("the trigger reflects the active scenario name when one is set", () => {
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "s1",
      setScenario: setScenarioSpy,
    });
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    expect(getTrigger()).toHaveAccessibleName("Roth conversion");
  });

  it("+ New scenario item calls useScenarioModeUI().openCreate and closes the menu", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /\+ New scenario/ }));
    expect(openCreateSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps a long scenario name on one line, with the full text in title", async () => {
    // Scenario names are free text. Before this, a row was a fixed-height pill
    // with no truncation: a long name wrapped and painted over the row below,
    // which read as a transparent menu. The row must stay one line and hand the
    // untruncated name to the tooltip.
    const user = userEvent.setup();
    const longName = "Move and Roth Conversion to the top of the 22% Bracket";
    render(
      <ScenarioChipRow
        clientId={CLIENT_ID}
        scenarios={[
          { id: "base", name: "Base case", isBaseCase: true },
          { id: "s1", name: longName, isBaseCase: false },
        ]}
      />,
    );
    await openMenu(user);

    const row = screen.getByRole("menuitemradio", { name: longName });
    expect(row).toHaveAttribute("title", longName);
    const label = screen.getByText(longName);
    expect(label.className).toContain("truncate");
  });

  it("renders a Delete button per non-base row and none on the base row", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    expect(
      screen.queryByRole("button", { name: /Delete scenario Base case/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Delete scenario Roth conversion/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete scenario Early retirement/ }),
    ).toBeInTheDocument();
  });

  it("clicking × on an inactive row confirms, fetches DELETE, and refreshes", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Delete scenario Roth conversion/ }),
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/scenarios/s1`,
      { method: "DELETE" },
    );
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // Inactive scenario: should not clear the URL.
    expect(setScenarioSpy).not.toHaveBeenCalled();
  });

  it("deleting the active row calls setScenario(null) and refreshes", async () => {
    const user = userEvent.setup();
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "s1",
      setScenario: setScenarioSpy,
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Delete scenario Roth conversion/ }),
    );

    expect(setScenarioSpy).toHaveBeenCalledWith(null);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("declining the confirm dialog skips the network call", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Delete scenario Roth conversion/ }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("clicking × does not propagate to the row's setScenario click", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Delete scenario Early retirement/ }),
    );

    // The row's main button should not have fired its own onClick.
    expect(setScenarioSpy).not.toHaveBeenCalled();
  });

  it("renders a Rename button per non-base row and none on the base row", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    expect(
      screen.queryByRole("button", { name: /Rename scenario Base case/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Rename scenario Early retirement/ }),
    ).toBeInTheDocument();
  });

  it("clicking ✎ swaps the row for an input seeded with the current name", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    );

    const input = screen.getByRole("textbox", {
      name: /Rename scenario Roth conversion/,
    });
    expect(input).toHaveValue("Roth conversion");
    // The row's select button is replaced while editing; other rows survive.
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    // Editing must not switch the active scenario.
    expect(setScenarioSpy).not.toHaveBeenCalled();
  });

  it("submitting the rename PATCHes the new name and refreshes", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    );
    const input = screen.getByRole("textbox", {
      name: /Rename scenario Roth conversion/,
    });
    await user.clear(input);
    await user.type(input, "  Roth ladder  {Enter}");

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/scenarios/s1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Roth ladder" }),
      },
    );
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("an unchanged name closes the editor without a network call", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Rename scenario Roth conversion/ }),
      "{Enter}",
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("Escape cancels the rename and leaves the menu open", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /Rename scenario Roth conversion/ }),
      "x{Escape}",
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("a failed rename keeps the editor open and shows an error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    );
    const input = screen.getByRole("textbox", {
      name: /Rename scenario Roth conversion/,
    });
    await user.clear(input);
    await user.type(input, "Roth ladder{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't rename/);
    expect(input).toBeInTheDocument();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("an empty name can't be submitted", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await openMenu(user);
    await user.click(
      screen.getByRole("button", { name: /Rename scenario Roth conversion/ }),
    );
    const input = screen.getByRole("textbox", {
      name: /Rename scenario Roth conversion/,
    });
    await user.clear(input);
    await user.type(input, "   {Enter}");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Save name for Roth conversion/ }),
    ).toBeDisabled();
  });
});
