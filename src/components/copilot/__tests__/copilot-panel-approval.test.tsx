// @vitest-environment jsdom
//
// Tests for Phase-2 ApprovalCard wiring in CopilotPanel.
// Mocks useCopilotStream with the real return shape so we can drive
// pendingApproval from the outside without a live SSE connection.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopilotPanel } from "../copilot-panel";
import type { UseCopilotStreamResult, PendingApproval } from "../use-copilot-stream";

// ---------------------------------------------------------------------------
// Mock next/navigation (needed by copilot-provider + panel internals)
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/overview",
  useSearchParams: () => new URLSearchParams("scenario=s1"),
}));

// ---------------------------------------------------------------------------
// Mock server actions
// ---------------------------------------------------------------------------
vi.mock("../actions", () => ({
  listMyConversations: vi.fn(async () => []),
  loadConversationMessages: vi.fn(async () => ({ messages: [], approval: null })),
}));

// ---------------------------------------------------------------------------
// Mock copilot provider — useCopilot() returns controlled state
// ---------------------------------------------------------------------------
vi.mock("../copilot-provider", () => ({
  useCopilot: () => ({
    scenarioId: "base",
    pathname: "/clients/c1/overview",
    isOpen: true,
    close: vi.fn(),
  }),
  // CopilotProvider used in copilot-panel.test.tsx but not needed here
  CopilotProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock scenario drawer (panel imports useScenarioDrawerOptional)
// ---------------------------------------------------------------------------
vi.mock("@/components/scenario/scenario-drawer-provider", () => ({
  ScenarioDrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useScenarioDrawerOptional: () => null,
}));

// ---------------------------------------------------------------------------
// Controlled stream state — reassigned per test
// ---------------------------------------------------------------------------
let mockStreamState: UseCopilotStreamResult;

vi.mock("../use-copilot-stream", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../use-copilot-stream")>();
  return {
    ...orig, // keep parseCopilotSse etc.
    useCopilotStream: () => mockStreamState,
  };
});

// ---------------------------------------------------------------------------
// Helper: build a default stream result (idle, no messages, no approval)
// ---------------------------------------------------------------------------
function makeStreamState(overrides: Partial<UseCopilotStreamResult> = {}): UseCopilotStreamResult {
  return {
    messages: [],
    setMessages: vi.fn(),
    streamingText: "",
    toolStatus: null,
    pendingApproval: null,
    setPendingApproval: vi.fn(),
    status: "idle",
    errorMessage: null,
    conversationId: "conv-1",
    setConversationId: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    ...overrides,
  };
}

const SAMPLE_APPROVAL: PendingApproval = {
  previews: [
    {
      summary: "Add Roth conversion: $40,000 in 2026",
      name: "propose_changes",
      details: ["+$214k"],
    },
  ],
  calls: [{ id: "call_a", name: "propose_changes", args: {} }],
};

function mountPanel() {
  return render(
    <CopilotPanel clientId="c1" scenarioNames={{ base: "Base case" }} forceOpenForTest />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CopilotPanel approval slot — Phase 2", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
  });

  it("(1) does NOT render ApprovalCard text when pendingApproval is null", () => {
    mockStreamState = makeStreamState({ pendingApproval: null });
    mountPanel();
    expect(screen.queryByText(/copilot wants to make/i)).toBeNull();
    // Also confirm the old placeholder is gone
    expect(document.querySelector("[data-testid='approval-slot']")).toBeNull();
  });

  it("(2) renders ApprovalCard summary and details when pendingApproval is set", () => {
    mockStreamState = makeStreamState({ pendingApproval: SAMPLE_APPROVAL });
    mountPanel();
    expect(screen.getByText("Copilot wants to make 1 change")).toBeInTheDocument();
    expect(screen.getByText("Add Roth conversion: $40,000 in 2026")).toBeInTheDocument();
    expect(screen.getByText("+$214k")).toBeInTheDocument();
  });

  it("(3) clicking Confirm row 1 then Apply selected calls resume({ call_a: 'confirm' })", async () => {
    const resumeMock = vi.fn();
    mockStreamState = makeStreamState({
      pendingApproval: SAMPLE_APPROVAL,
      resume: resumeMock,
    });
    mountPanel();

    // Click the "Confirm" button for row 1
    const confirmBtn = screen.getByRole("button", { name: /confirm row 1/i });
    await userEvent.click(confirmBtn);

    // Click the "Apply selected (1)" button
    const applyBtn = screen.getByRole("button", { name: /apply selected/i });
    await userEvent.click(applyBtn);

    expect(resumeMock).toHaveBeenCalledOnce();
    expect(resumeMock).toHaveBeenCalledWith({ call_a: "confirm" });
  });
});
