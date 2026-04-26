// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { useScenarioState } from "@/hooks/use-scenario-state";
import { ScenarioModeBanner } from "../scenario-mode-banner";

vi.mock("@/hooks/use-scenario-state", () => ({
  useScenarioState: vi.fn(),
}));

const CLIENT_ID = "client-123";

const SCENARIOS = [
  { id: "base-1", name: "Base case", isBaseCase: true },
  { id: "alt-1", name: "Roth conversion", isBaseCase: false },
];

beforeEach(() => {
  vi.mocked(useScenarioState).mockReset();
});

describe("ScenarioModeBanner", () => {
  it("renders nothing when scenarioId is null (base case, no ?scenario= param)", () => {
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: null,
      setScenario: vi.fn(),
    });
    const { container } = render(
      <ScenarioModeBanner clientId={CLIENT_ID} scenarios={SCENARIOS} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when scenarioId has no matching scenario in the array", () => {
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "missing-id",
      setScenario: vi.fn(),
    });
    const { container } = render(
      <ScenarioModeBanner clientId={CLIENT_ID} scenarios={SCENARIOS} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when scenarioId points at the explicit base scenario", () => {
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "base-1",
      setScenario: vi.fn(),
    });
    const { container } = render(
      <ScenarioModeBanner clientId={CLIENT_ID} scenarios={SCENARIOS} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner with the active non-base scenario's name", () => {
    vi.mocked(useScenarioState).mockReturnValue({
      scenarioId: "alt-1",
      setScenario: vi.fn(),
    });
    render(<ScenarioModeBanner clientId={CLIENT_ID} scenarios={SCENARIOS} />);
    expect(
      screen.getByText(
        /EDITING SCENARIO · Roth conversion · CHANGES TRACKED IN PANEL/,
      ),
    ).toBeInTheDocument();
  });
});
