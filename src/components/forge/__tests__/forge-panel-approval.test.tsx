// @vitest-environment jsdom
//
// Tests for Phase-2 ApprovalCard wiring in ForgePanel.
// Mocks useForgeStream with the real return shape so we can drive
// pendingApproval from the outside without a live SSE connection.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgePanel } from "../forge-panel";
import type { UseForgeStreamResult, PendingApproval } from "../use-forge-stream";

// ---------------------------------------------------------------------------
// Mock next/navigation (needed by forge-provider + panel internals)
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
// Mock forge provider — useForge() returns controlled state
// ---------------------------------------------------------------------------
vi.mock("../forge-provider", () => ({
  useForge: () => ({
    scenarioId: "base",
    pathname: "/clients/c1/overview",
    isOpen: true,
    close: vi.fn(),
  }),
  // ForgeProvider used in forge-panel.test.tsx but not needed here
  ForgeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
let mockStreamState: UseForgeStreamResult;

vi.mock("../use-forge-stream", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../use-forge-stream")>();
  return {
    ...orig, // keep parseForgeSse etc.
    useForgeStream: () => mockStreamState,
  };
});

// ---------------------------------------------------------------------------
// Helper: build a default stream result (idle, no messages, no approval)
// ---------------------------------------------------------------------------
function makeStreamState(overrides: Partial<UseForgeStreamResult> = {}): UseForgeStreamResult {
  return {
    messages: [],
    setMessages: vi.fn(),
    streamingText: "",
    toolStatus: null,
    lastToolRender: null,
    pendingNavigate: null,
    setPendingNavigate: vi.fn(),
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
    <ForgePanel
      clientId="c1"
      clientName="Jane & John Smith"
      scenarioNames={{ base: "Base case" }}
      forceOpenForTest
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ForgePanel approval slot — Phase 2", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
  });

  it("(1) does NOT render ApprovalCard text when pendingApproval is null", () => {
    mockStreamState = makeStreamState({ pendingApproval: null });
    mountPanel();
    expect(screen.queryByText(/forge wants to make/i)).toBeNull();
    // Also confirm the old placeholder is gone
    expect(document.querySelector("[data-testid='approval-slot']")).toBeNull();
  });

  it("(2) renders ApprovalCard summary and details when pendingApproval is set", () => {
    mockStreamState = makeStreamState({ pendingApproval: SAMPLE_APPROVAL });
    mountPanel();
    expect(screen.getByText("Forge wants to make 1 change")).toBeInTheDocument();
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

  it("(4) locks the composer while an approval is pending (no new /stream turn)", () => {
    // The graph is checkpointed mid-interrupt; the only valid next step is
    // Confirm/Cancel → /resume. Sending a fresh /stream turn would corrupt the
    // pending proposal, so the textarea + send button must be disabled even
    // though status is "idle"/"done" (not "streaming") while the card is up.
    mockStreamState = makeStreamState({ pendingApproval: SAMPLE_APPROVAL, status: "done" });
    mountPanel();
    expect(screen.getByRole("textbox", { name: /ask forge/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });
});
