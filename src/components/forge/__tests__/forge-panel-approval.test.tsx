// @vitest-environment jsdom
//
// Tests for Phase-2 ApprovalCard wiring in ForgePanel.
// Mocks useForgeStream with the real return shape so we can drive
// pendingApproval from the outside without a live SSE connection.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgePanel } from "../forge-panel";
import type { UseForgeStreamResult, PendingApproval } from "../use-forge-stream";

// ---------------------------------------------------------------------------
// Mock next/navigation (needed by forge-provider + panel internals).
// refreshMock is hoisted + stable so a test can assert the panel calls
// router.refresh() after a committed resume (server-rendered plan views only
// re-fetch on a soft refresh).
// ---------------------------------------------------------------------------
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
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
// Mock walkthrough context (panel imports useWalkthrough — Task 9 handoff)
// ---------------------------------------------------------------------------
vi.mock("../walkthrough-context", () => ({
  useWalkthrough: () => ({ active: null, stepIndex: 0, currentStep: null, start: vi.fn(), next: vi.fn(), exit: vi.fn() }),
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
    pendingWalkthrough: null,
    setPendingWalkthrough: vi.fn(),
    isVerifying: false,
    pendingApproval: null,
    setPendingApproval: vi.fn(),
    status: "idle",
    errorMessage: null,
    conversationId: "conv-1",
    setConversationId: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    pendingMeetingReview: null,
    resumeMeetingReview: vi.fn(),
    retry: vi.fn(),
    retryAfterSeconds: null,
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
    refreshMock.mockClear();
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

  it("(3) clicking Approve calls resume({ call_a: 'confirm' })", async () => {
    // SAMPLE_APPROVAL carries one change, so the card renders its collapsed
    // Reject/Approve form — a single click is the whole interaction. (It used
    // to take two: a per-row Confirm pill, then "Apply selected". Skipping the
    // pill and clicking the primary submitted a DECLINE; see approval-card.test
    // for the regression that pins this.)
    const resumeMock = vi.fn();
    mockStreamState = makeStreamState({
      pendingApproval: SAMPLE_APPROVAL,
      resume: resumeMock,
    });
    mountPanel();

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

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

  it("(6) refreshes the server-rendered page after a confirmed Approve", async () => {
    // A confirmed write commits during the resume; the host planning views are
    // server components, so the panel must soft-refresh or the advisor sees
    // stale data (e.g. deleted accounts still listed) until a manual reload.
    const resumeMock = vi.fn(async () => {});
    mockStreamState = makeStreamState({
      pendingApproval: SAMPLE_APPROVAL,
      resume: resumeMock,
    });
    mountPanel();

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(resumeMock).toHaveBeenCalledWith({ call_a: "confirm" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });

  it("(7) does NOT refresh when the advisor rejects (Reject)", async () => {
    // A reject-only resume mutates nothing, so there is nothing to re-fetch.
    // On the collapsed card the decline goes through onSubmit (all-reject)
    // rather than onCancel; both resume the graph identically, and neither
    // may trigger a refresh.
    const resumeMock = vi.fn(async () => {});
    mockStreamState = makeStreamState({
      pendingApproval: SAMPLE_APPROVAL,
      resume: resumeMock,
    });
    mountPanel();

    await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    expect(resumeMock).toHaveBeenCalledWith({ call_a: "reject" });
    // Flush any microtask the resume-then chain might schedule, then assert.
    await Promise.resolve();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A4 — Retry button hidden while an approval is pending
// (requires controlled mock to hold status===error AND pendingApproval!=null
//  simultaneously — which is impossible to drive through the real hook)
// ---------------------------------------------------------------------------
describe("ForgePanel Retry button — A4 (pendingApproval guard)", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
  });

  it("(5) hides the Retry button while pendingApproval is set", () => {
    // status === "error" with a pending approval: the approval card takes
    // precedence, so the Retry button must not render alongside it.
    mockStreamState = makeStreamState({
      status: "error",
      errorMessage: "Something went wrong",
      pendingApproval: SAMPLE_APPROVAL,
    });
    mountPanel();
    // The error message itself is shown (error block is still rendered)…
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    // …but the Retry button is hidden while the approval is pending.
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
