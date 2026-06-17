// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  ScenarioDrawerProvider,
  useScenarioDrawer,
} from "@/components/scenario/scenario-drawer-provider";
import { ForgeProvider, useForge } from "../forge-provider";

// next/navigation: the provider re-reads useScenarioState (URL is source of
// truth). A stable mock keeps the chip/scope deterministic in the test.
import { vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/overview",
  useSearchParams: () => new URLSearchParams("scenario=s1"),
}));

function Probe() {
  const drawer = useScenarioDrawer();
  const copilot = useForge();
  return (
    <div>
      <span data-testid="drawer-open">{String(drawer.open)}</span>
      <span data-testid="copilot-open">{String(copilot.isOpen)}</span>
      <span data-testid="scenario">{String(copilot.scenarioId)}</span>
      <button onClick={() => drawer.setOpen(true)}>open-drawer</button>
      <button onClick={() => copilot.open()}>open-copilot</button>
    </div>
  );
}

describe("ForgeProvider mutual exclusion", () => {
  it("closes the scenario drawer when the copilot opens; exposes live scenarioId", () => {
    render(
      <ScenarioDrawerProvider>
        <ForgeProvider clientId="c1">
          <Probe />
        </ForgeProvider>
      </ScenarioDrawerProvider>,
    );

    // scenarioId reflects the URL ?scenario=s1
    expect(screen.getByTestId("scenario").textContent).toBe("s1");

    // open the drawer
    act(() => {
      screen.getByText("open-drawer").click();
    });
    expect(screen.getByTestId("drawer-open").textContent).toBe("true");

    // open the copilot → drawer must close (one right panel at a time)
    act(() => {
      screen.getByText("open-copilot").click();
    });
    expect(screen.getByTestId("copilot-open").textContent).toBe("true");
    expect(screen.getByTestId("drawer-open").textContent).toBe("false");
  });
});
