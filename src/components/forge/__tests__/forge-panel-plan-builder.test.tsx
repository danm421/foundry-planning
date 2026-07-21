// @vitest-environment jsdom
//
// Tests for Task B5's `build_plan` tool_render wiring in ForgePanel: the
// frame is the only way the panel learns the clientId/importId a build_plan
// tool call minted (tool results go to the model, not the client). Mocks
// useForgeStream (to drive lastToolRender from the outside, mirroring the
// Phase-2 approval tests) and useForgeImport (to spy on runPlanBuild).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ForgePanel } from "../forge-panel";
import type { UseForgeStreamResult } from "../use-forge-stream";

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

  it("does not show the attach affordance in global mode before a build_plan frame arrives", () => {
    mockStreamState = makeStreamState({ lastToolRender: null });
    mountGlobalPanel();
    expect(screen.queryByLabelText("Attach a document")).toBeNull();
  });

  it("a build_plan tool_render frame enables the attach affordance in global mode (clientId == null)", async () => {
    mockStreamState = makeStreamState({ lastToolRender: null });
    const { rerender } = mountGlobalPanel();
    expect(screen.queryByLabelText("Attach a document")).toBeNull();

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
