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

describe("ScenarioChipRow", () => {
  it("renders a button per scenario in order plus the + New scenario chip", () => {
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    // Filter out the per-non-base × delete buttons; we just want the main chips.
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => !b.getAttribute("aria-label")?.startsWith("Delete scenario"));
    // 3 scenarios + the "+ New scenario" button
    expect(buttons).toHaveLength(4);
    expect(buttons[0].textContent).toContain("Base case");
    expect(buttons[1].textContent).toContain("Roth conversion");
    expect(buttons[2].textContent).toContain("Early retirement");
    expect(buttons[3].textContent).toContain("+ New scenario");
  });

  it("shows the base-case chip as active when scenarioId is null", () => {
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    const baseBtn = screen.getByRole("button", { name: /Base case/ });
    expect(baseBtn.textContent?.startsWith("● ")).toBe(true);
    const otherBtn = screen.getByRole("button", { name: /^Roth conversion$/ });
    expect(otherBtn.textContent?.startsWith("○ ")).toBe(true);
  });

  it("clicking a non-base chip calls setScenario with that scenario id", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await user.click(screen.getByRole("button", { name: /^Roth conversion$/ }));
    expect(setScenarioSpy).toHaveBeenCalledTimes(1);
    expect(setScenarioSpy).toHaveBeenCalledWith("s1");
  });

  it("clicking the active base chip calls setScenario(null) to clear the URL", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await user.click(screen.getByRole("button", { name: /Base case/ }));
    expect(setScenarioSpy).toHaveBeenCalledTimes(1);
    expect(setScenarioSpy).toHaveBeenCalledWith(null);
  });

  it("active chip carries aria-pressed=true; inactive chips carry aria-pressed=false", () => {
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "s1",
      setScenario: setScenarioSpy,
    });
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    const activeBtn = screen.getByRole("button", { name: /^Roth conversion$/ });
    const inactiveBase = screen.getByRole("button", { name: /Base case/ });
    const inactiveOther = screen.getByRole("button", { name: /^Early retirement$/ });
    expect(activeBtn).toHaveAttribute("aria-pressed", "true");
    expect(inactiveBase).toHaveAttribute("aria-pressed", "false");
    expect(inactiveOther).toHaveAttribute("aria-pressed", "false");
  });

  it("+ New scenario button calls useScenarioModeUI().openCreate", async () => {
    const user = userEvent.setup();
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await user.click(screen.getByRole("button", { name: /\+ New scenario/ }));
    expect(openCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("renders a Delete button per non-base chip and none on the base chip", () => {
    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
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

  it("clicking × on an inactive chip confirms, fetches DELETE, and refreshes", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
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

  it("deleting the active chip calls setScenario(null) and refreshes", async () => {
    const user = userEvent.setup();
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "s1",
      setScenario: setScenarioSpy,
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
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
    await user.click(
      screen.getByRole("button", { name: /Delete scenario Roth conversion/ }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("clicking × does not propagate to the parent chip's setScenario click", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ScenarioChipRow clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    await user.click(
      screen.getByRole("button", { name: /Delete scenario Early retirement/ }),
    );

    // The chip's main button should not have fired its own onClick.
    expect(setScenarioSpy).not.toHaveBeenCalled();
  });
});
