// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

import {
  ScenarioModeWrapper,
  useScenarioModeUI,
} from "../scenario-mode-wrapper";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/clients/client-123",
  useSearchParams: () => new URLSearchParams(),
}));

const SCENARIOS = [
  { id: "base", name: "Base case", isBaseCase: true },
  { id: "s1", name: "Roth conversion", isBaseCase: false },
];

describe("ScenarioModeWrapper", () => {
  it("provides openCreate to descendant consumers via context", () => {
    const seen: { openCreate: () => void }[] = [];
    function Probe() {
      seen.push(useScenarioModeUI());
      return <div data-testid="probe">probe</div>;
    }
    render(
      <ScenarioModeWrapper clientId="client-123" scenarios={SCENARIOS}>
        <Probe />
      </ScenarioModeWrapper>,
    );
    expect(screen.getByTestId("probe")).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect(typeof seen[0].openCreate).toBe("function");
  });

  it("calling openCreate from a consumer mounts the create-scenario dialog", async () => {
    function OpenButton() {
      const { openCreate } = useScenarioModeUI();
      return (
        <button type="button" onClick={openCreate}>
          open
        </button>
      );
    }
    render(
      <ScenarioModeWrapper clientId="client-123" scenarios={SCENARIOS}>
        <OpenButton />
      </ScenarioModeWrapper>,
    );
    // Dialog is closed initially.
    expect(screen.queryByRole("dialog")).toBeNull();

    // Clicking the consumer button calls openCreate → dialog renders.
    await act(async () => {
      screen.getByRole("button", { name: "open" }).click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
