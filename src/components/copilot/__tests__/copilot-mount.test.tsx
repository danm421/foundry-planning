// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioDrawerProvider } from "@/components/scenario/scenario-drawer-provider";
import { CopilotMount } from "../copilot-mount";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/overview",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../actions", () => ({
  listMyConversations: vi.fn(async () => []),
  loadConversationMessages: vi.fn(async () => ({ messages: [], approval: null })),
}));

function tree(enabled: boolean) {
  return (
    <ScenarioDrawerProvider>
      <CopilotMount clientId="c1" enabled={enabled} scenarioNames={{}} />
    </ScenarioDrawerProvider>
  );
}

describe("CopilotMount", () => {
  it("renders the launcher when enabled", () => {
    render(tree(true));
    expect(screen.getByRole("button", { name: /open copilot/i })).toBeInTheDocument();
  });

  it("renders nothing when the flag is off", () => {
    render(tree(false));
    expect(screen.queryByRole("button", { name: /open copilot/i })).toBeNull();
    expect(screen.queryByLabelText(/foundry copilot/i)).toBeNull();
  });
});
