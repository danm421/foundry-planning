// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ScenarioDrawerProvider,
} from "@/components/scenario/scenario-drawer-provider";
import { CopilotProvider } from "../copilot-provider";
import { CopilotPanel } from "../copilot-panel";

// Drive the URL scope. `current` is reassigned per render to simulate drift.
let currentSearch = "scenario=s1";
const currentPath = "/clients/c1/overview";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// Phase-0 server actions — mocked so the thread list doesn't hit the DB.
vi.mock("../actions", () => ({
  listMyConversations: vi.fn(async () => []),
  loadConversationMessages: vi.fn(async () => ({ messages: [], approval: null })),
}));

beforeEach(() => {
  currentSearch = "scenario=s1";
});

function mountPanel() {
  return render(
    <ScenarioDrawerProvider>
      <CopilotProvider clientId="c1">
        <CopilotPanel
          clientId="c1"
          scenarioNames={{ s1: "Roth scenario", s2: "Delay SS to 70" }}
          forceOpenForTest
        />
      </CopilotProvider>
    </ScenarioDrawerProvider>,
  );
}

describe("CopilotPanel", () => {
  it("renders the empty state and input (smoke)", async () => {
    mountPanel();
    expect(await screen.findByRole("textbox", { name: /ask the copilot/i })).toBeInTheDocument();
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument();
  });

  it("updates the scenario chip when the URL scenario changes (drift)", () => {
    const { rerender } = mountPanel();
    expect(screen.getByTestId("chip-scenario").textContent).toContain("Roth scenario");

    // Advisor switches ?scenario= mid-session → next render reads the new id.
    currentSearch = "scenario=s2";
    rerender(
      <ScenarioDrawerProvider>
        <CopilotProvider clientId="c1">
          <CopilotPanel
            clientId="c1"
            scenarioNames={{ s1: "Roth scenario", s2: "Delay SS to 70" }}
            forceOpenForTest
          />
        </CopilotProvider>
      </ScenarioDrawerProvider>,
    );
    expect(screen.getByTestId("chip-scenario").textContent).toContain("Delay SS to 70");
  });
});
