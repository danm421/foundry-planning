// @vitest-environment jsdom
//
// Tests for Task B5's `build_plan` tool_render wiring in ForgePanel: the
// frame is the only way the panel learns the clientId/importId a build_plan
// tool call minted (tool results go to the model, not the client). Mocks
// useForgeStream (to drive lastToolRender from the outside, mirroring the
// Phase-2 approval tests) and useForgeImport (to spy on runPlanBuild).
//
// Task 6 un-gated the paperclip in global mode (attach-first fact-finder
// ingest), which superseded two of this file's original assertions that the
// attach affordance only appeared after a build_plan frame arrived — those
// two tests were updated in place to describe the new (still-visible)
// behavior rather than removed, since the frame-arrival wiring they otherwise
// exercise (via runPlanBuild call counts, below) remains load-bearing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ForgePanel } from "../forge-panel";
import type { UseForgeStreamResult, PendingApproval } from "../use-forge-stream";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients",
  useSearchParams: () => new URLSearchParams(""),
}));

// ---------------------------------------------------------------------------
// Mock server actions
// ---------------------------------------------------------------------------
vi.mock("../actions", () => ({
  listMyConversations: vi.fn(async () => []),
  loadConversationMessages: vi.fn(async () => ({ messages: [], approval: null })),
  resolveBaseScenarioId: vi.fn(async () => "base"),
}));

// ---------------------------------------------------------------------------
// Mock forge provider — useForge() returns controlled state. clientId comes
// from the prop passed straight to ForgePanel, not from this provider.
// ---------------------------------------------------------------------------
vi.mock("../forge-provider", () => ({
  useForge: () => ({
    scenarioId: null,
    pathname: "/clients",
    isOpen: true,
    close: vi.fn(),
  }),
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
// Mock walkthrough context (panel imports useWalkthrough)
// ---------------------------------------------------------------------------
vi.mock("../walkthrough-context", () => ({
  useWalkthrough: () => ({ active: null, stepIndex: 0, currentStep: null, start: vi.fn(), next: vi.fn(), exit: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Mock useForgeImport — spy on runPlanBuild without hitting real fetch.
// ---------------------------------------------------------------------------
const importMocks = vi.hoisted(() => ({
  runImport: vi.fn(),
  runPlanBuild: vi.fn(async () => null as unknown),
  submitPlanAnswers: vi.fn(async () => null as unknown),
}));
vi.mock("../use-forge-import", () => ({
  useForgeImport: () => ({
    status: "idle",
    errorMessage: null,
    runImport: importMocks.runImport,
    runPlanBuild: importMocks.runPlanBuild,
    submitPlanAnswers: importMocks.submitPlanAnswers,
    reset: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Controlled stream state — reassigned per test
// ---------------------------------------------------------------------------
let mockStreamState: UseForgeStreamResult;

vi.mock("../use-forge-stream", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../use-forge-stream")>();
  return {
    ...orig,
    useForgeStream: () => mockStreamState,
  };
});

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

function buildPlanFrame(importId: string): Extract<UseForgeStreamResult["lastToolRender"], { name: string }> {
  return {
    type: "tool_render",
    name: "build_plan",
    status: "complete",
    data: { clientId: "c9", importId, mode: "new" },
  };
}

function mountGlobalPanel() {
  return render(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
}

describe("ForgePanel — build_plan tool_render wiring (Task B5)", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
    importMocks.runImport.mockClear();
    importMocks.runPlanBuild.mockClear();
    importMocks.runPlanBuild.mockResolvedValue(null);
    importMocks.submitPlanAnswers.mockClear();
  });

  // Task 6 un-gates the paperclip in global mode (attach-first fact-finder
  // ingest entry point), superseding the prior "only after a build_plan frame"
  // gating this describe block originally asserted. The two tests below now
  // document that: the affordance is available from the start, and a
  // build_plan frame arriving later doesn't change its visibility (it was
  // already visible).
  it("shows the attach affordance in global mode even before any tool_render frame arrives (Task 6 attach-first ingest)", () => {
    mockStreamState = makeStreamState({ lastToolRender: null });
    mountGlobalPanel();
    expect(screen.getByLabelText("Attach a document")).toBeInTheDocument();
  });

  it("the attach affordance stays available in global mode once a build_plan tool_render frame arrives", async () => {
    mockStreamState = makeStreamState({ lastToolRender: null });
    const { rerender } = mountGlobalPanel();
    expect(screen.getByLabelText("Attach a document")).toBeInTheDocument();

    mockStreamState = makeStreamState({ lastToolRender: buildPlanFrame("imp_1") });
    await act(async () => {
      rerender(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
    });

    expect(screen.getByLabelText("Attach a document")).toBeInTheDocument();
  });

  it("the same frame arriving twice with the same importId triggers only ONE runPlanBuild", async () => {
    mockStreamState = makeStreamState({ lastToolRender: null });
    const { rerender } = mountGlobalPanel();

    // Attach a file directly on the hidden input — the button isn't visible
    // yet (attachTarget is still null), but the input itself is unconditional.
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });

    // First arrival: files are already attached, so the panel should kick off
    // runPlanBuild immediately (no second Send click required).
    mockStreamState = makeStreamState({ lastToolRender: buildPlanFrame("imp_1") });
    await act(async () => {
      rerender(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
    });
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(1);

    // Second arrival: a NEW frame object, same importId (lastToolRender is
    // never cleared by the hook and can resurface on a later turn/re-render).
    // The handledPlanBuildRef guard must block a second call.
    mockStreamState = makeStreamState({ lastToolRender: buildPlanFrame("imp_1") });
    await act(async () => {
      rerender(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
    });
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(1);
  });

  it("sends a NON-EMPTY narration message when the advisor typed nothing", async () => {
    // The attachment alone is a valid turn, so the composer is usually empty.
    // The GLOBAL stream route rejects an empty message outright (400) and has
    // no pendingImportId escape hatch like the client route — so an empty
    // narration would surface a raw 400 under a plan that assembled fine.
    const send = vi.fn();
    importMocks.runPlanBuild.mockResolvedValue({
      importId: "imp_1",
      clientId: "c9",
      reviewPath: "/clients/c9/details/import/imp_1",
      assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions: [] },
      warnings: [],
    });

    mockStreamState = makeStreamState({ lastToolRender: null, send });
    const { rerender } = mountGlobalPanel();
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });

    mockStreamState = makeStreamState({ lastToolRender: buildPlanFrame("imp_1"), send });
    await act(async () => {
      rerender(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
    });

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0] as { message: string };
    expect(sent.message.trim().length).toBeGreaterThan(0);
  });

  it("a frame with a DIFFERENT importId is treated as a new build", async () => {
    mockStreamState = makeStreamState({ lastToolRender: null });
    const { rerender } = mountGlobalPanel();
    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });

    mockStreamState = makeStreamState({ lastToolRender: buildPlanFrame("imp_1") });
    await act(async () => {
      rerender(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
    });
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(1);

    // Attach again for the second build (the first call cleared `attached`).
    fireEvent.change(fileInput, { target: { files: [new File(["y"], "stmt2.pdf")] } });
    mockStreamState = makeStreamState({ lastToolRender: buildPlanFrame("imp_2") });
    await act(async () => {
      rerender(<ForgePanel clientId={null} scenarioNames={{}} forceOpenForTest />);
    });
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// FIX 4 (whole-branch review): planBuild was only ever reset by newChat()/
// selectThread(), so once a build completed, EVERY later attach+send in the
// same thread re-routed into onSend's plan-build branch (checked before the
// normal import branch) — hijacking a plain "attach one more statement"
// import into the already-reviewed import and silently discarding any
// review-wizard edits. Mounted in CLIENT mode (clientId set) because the
// normal-import branch this bug makes unreachable is client-only.
// ---------------------------------------------------------------------------
describe("ForgePanel — planBuild clears after a successful build (FIX 4)", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
    importMocks.runImport.mockClear();
    importMocks.runPlanBuild.mockClear();
    importMocks.runPlanBuild.mockResolvedValue(null);
    importMocks.runImport.mockResolvedValue(null);
    importMocks.submitPlanAnswers.mockClear();
  });

  function clientBuildPlanFrame(importId: string): Extract<UseForgeStreamResult["lastToolRender"], { name: string }> {
    return {
      type: "tool_render",
      name: "build_plan",
      status: "complete",
      data: { clientId: "c1", importId, mode: "existing" },
    };
  }

  it("after a completed plan build, a subsequent attach+send calls runImport (not runPlanBuild) — and the stale-frame guard still holds", async () => {
    const send = vi.fn();
    importMocks.runPlanBuild.mockResolvedValue({
      importId: "imp_1",
      clientId: "c1",
      reviewPath: "/clients/c1/details/import/imp_1",
      assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions: [] },
      warnings: [],
    });
    importMocks.runImport.mockResolvedValue({
      importId: "imp_2",
      summary: { extract: { succeeded: 1, failed: 0 }, match: { exact: 0, fuzzy: 0, new: 1 } },
      warnings: [],
    });

    mockStreamState = makeStreamState({ lastToolRender: null, send });
    const { rerender } = render(<ForgePanel clientId="c1" scenarioNames={{}} forceOpenForTest />);

    // build_plan frame arrives with no files attached yet — records the
    // target only, no build kicks off.
    const frame1 = clientBuildPlanFrame("imp_1");
    mockStreamState = makeStreamState({ lastToolRender: frame1, send });
    await act(async () => {
      rerender(<ForgePanel clientId="c1" scenarioNames={{}} forceOpenForTest />);
    });
    expect(importMocks.runPlanBuild).not.toHaveBeenCalled();

    const fileInput = screen.getByTestId("forge-file-input") as HTMLInputElement;
    const clickSend = async () => {
      await act(async () => {
        fireEvent.click(screen.getByLabelText("Send message"));
      });
    };

    // First attach+send: onSend's plan-build branch fires.
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "stmt.pdf")] } });
    await clickSend();
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(1);
    expect(importMocks.runImport).not.toHaveBeenCalled();

    // Second attach+send in the SAME thread: planBuild must now be cleared,
    // so this routes through the normal import branch instead of hijacking
    // another file into the already-reviewed import.
    fireEvent.change(fileInput, { target: { files: [new File(["y"], "stmt2.pdf")] } });
    await clickSend();
    expect(importMocks.runImport).toHaveBeenCalledTimes(1);
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(1); // still just once

    // The stale-frame guard (handledPlanBuildRef) still holds: the SAME
    // frame object (never cleared by the hook) re-appearing on a later
    // render must NOT re-trigger a build, even though planBuild was cleared
    // by the fix above.
    mockStreamState = makeStreamState({ lastToolRender: frame1, send });
    await act(async () => {
      rerender(<ForgePanel clientId="c1" scenarioNames={{}} forceOpenForTest />);
    });
    expect(importMocks.runPlanBuild).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — global Forge discoverability. Copy-only: the clientless panel's
// empty state and composer placeholder must describe what the clientless
// panel can actually do (find a client, build a plan from documents) instead
// of leaking client-scoped copy that doesn't apply with no plan in context.
// Also retires "Confirm or cancel" for the pending-approval placeholder — a
// one-change card renders Approve/Reject only, so the old copy named a
// control that isn't on screen.
// ---------------------------------------------------------------------------
const SAMPLE_APPROVAL: PendingApproval = {
  previews: [{ summary: "Add Roth conversion: $40,000 in 2026", name: "propose_changes" }],
  calls: [{ id: "call_a", name: "propose_changes", args: {} }],
};

describe("clientless Forge discoverability", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
    importMocks.runImport.mockClear();
    importMocks.runPlanBuild.mockClear();
    importMocks.submitPlanAnswers.mockClear();
  });

  it("advertises the plan builder in the empty state when there is no client", () => {
    mountGlobalPanel();
    expect(
      screen.getByText(/build a plan for a new prospect from their documents/i),
    ).toBeInTheDocument();
  });

  it("keeps the plan-scoped empty state when a client IS in scope", () => {
    render(<ForgePanel clientId="c1" scenarioNames={{}} forceOpenForTest />);
    expect(screen.getByText(/explain the plan, run the numbers/i)).toBeInTheDocument();
  });

  it("uses a clientless composer placeholder when there is no client", () => {
    mountGlobalPanel();
    expect(
      screen.getByPlaceholderText(/build a plan, find a client, or ask/i),
    ).toBeInTheDocument();
  });

  it("uses the plan placeholder when a client IS in scope", () => {
    render(<ForgePanel clientId="c1" scenarioNames={{}} forceOpenForTest />);
    expect(screen.getByPlaceholderText(/ask about this plan/i)).toBeInTheDocument();
  });

  it("labels the approval composer for approve/reject, not confirm/cancel", () => {
    // A one-change card renders Approve/Reject; the old copy said "cancel",
    // which names no control on screen. pendingApproval is driven through the
    // mocked useForgeStream return value — the same lever
    // forge-panel-approval.test.tsx uses — rather than a test-only prop.
    mockStreamState = makeStreamState({ pendingApproval: SAMPLE_APPROVAL });
    mountGlobalPanel();
    expect(screen.getByPlaceholderText(/approve or reject/i)).toBeInTheDocument();
  });
});
