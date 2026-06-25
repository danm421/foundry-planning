// @vitest-environment jsdom
//
// Tests for transcript paste-detection, ask-first prompt, and processTranscript
// wiring in ForgePanel.
// Mocks useForgeStream with the real return shape and fetch for the stash route.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgePanel } from "../forge-panel";
import type { UseForgeStreamResult } from "../use-forge-stream";

// ---------------------------------------------------------------------------
// Mock next/navigation
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
// Mock forge provider
// ---------------------------------------------------------------------------
vi.mock("../forge-provider", () => ({
  useForge: () => ({
    scenarioId: "base",
    pathname: "/clients/c1/overview",
    isOpen: true,
    close: vi.fn(),
  }),
  ForgeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock scenario drawer
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

// A big transcript with speaker labels to trigger detection (>1000 chars, >=3 speaker lines)
const BIG_TRANSCRIPT = `John Smith: Good morning everyone, let's get started with the agenda.
Jane Doe: Thanks John. I'll start with the Q3 review.
John Smith: Great, please go ahead.
Jane Doe: So Q3 revenue was up 12% year over year. We saw strong performance in the West region.
John Smith: That's encouraging. What about the East region?
Jane Doe: East region was flat, about 2% growth. We're looking at some new initiatives there.
Bob Johnson: I can speak to that. We've been piloting a new outreach program since September.
Jane Doe: Yes, and early results look promising.
John Smith: Good to hear. Let's talk about Q4 projections.
Bob Johnson: We're targeting 15% growth for Q4 if the new program takes hold.
Jane Doe: I think that's achievable. The pipeline looks solid.
John Smith: Excellent. Now let's move to the planning topics. Dan, can you walk us through the estate planning update?
`.repeat(5); // repeat to ensure >1000 chars

const SHORT_TEXT = "Hello, this is a short message.";

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
describe("ForgePanel transcript paste-detection", () => {
  beforeEach(() => {
    mockStreamState = makeStreamState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(1) pasting a transcript shows the ask-first prompt", async () => {
    mountPanel();
    const textarea = screen.getByRole("textbox", { name: /ask forge/i });

    fireEvent.paste(textarea, {
      clipboardData: { getData: () => BIG_TRANSCRIPT },
    });

    expect(screen.getByText(/looks like a meeting transcript/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes, summarize/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no, just paste it/i })).toBeInTheDocument();
  });

  it("(2) pasting a non-transcript does NOT show the ask-first prompt", () => {
    mountPanel();
    const textarea = screen.getByRole("textbox", { name: /ask forge/i });

    fireEvent.paste(textarea, {
      clipboardData: { getData: () => SHORT_TEXT },
    });

    expect(screen.queryByText(/looks like a meeting transcript/i)).toBeNull();
  });

  it("(3) clicking 'Yes, summarize' POSTs to /forge/transcript and calls send with pendingTranscriptId", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const setMessagesMock = vi.fn();
    mockStreamState = makeStreamState({ send: sendMock, setMessages: setMessagesMock });

    // Mock fetch: stash route returns transcriptId
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transcriptId: "txid-123" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    mountPanel();

    const textarea = screen.getByRole("textbox", { name: /ask forge/i });
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => BIG_TRANSCRIPT },
    });

    // Ask-first prompt should appear
    const yesBtn = screen.getByRole("button", { name: /yes, summarize/i });
    await userEvent.click(yesBtn);

    // fetch should have been called with the stash route
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/c1/forge/transcript",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "content-type": "application/json" }),
          body: expect.stringContaining('"source":"paste"'),
        }),
      );
    });

    // send should have been called with pendingTranscriptId
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ pendingTranscriptId: "txid-123", skipUserBubble: true }),
      );
    });
  });

  it("(4) clicking 'No, just paste it' puts the text into the composer and dismisses the prompt", async () => {
    mountPanel();
    const textarea = screen.getByRole("textbox", { name: /ask forge/i });

    fireEvent.paste(textarea, {
      clipboardData: { getData: () => BIG_TRANSCRIPT },
    });

    expect(screen.getByText(/looks like a meeting transcript/i)).toBeInTheDocument();

    const noBtn = screen.getByRole("button", { name: /no, just paste it/i });
    await userEvent.click(noBtn);

    // Prompt should be dismissed
    expect(screen.queryByText(/looks like a meeting transcript/i)).toBeNull();
  });

  it("(5) shows an error bubble when stash route fails", async () => {
    const setMessagesMock = vi.fn();
    mockStreamState = makeStreamState({ setMessages: setMessagesMock });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    mountPanel();
    const textarea = screen.getByRole("textbox", { name: /ask forge/i });
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => BIG_TRANSCRIPT },
    });

    const yesBtn = screen.getByRole("button", { name: /yes, summarize/i });
    await userEvent.click(yesBtn);

    await waitFor(() => {
      expect(setMessagesMock).toHaveBeenCalled();
    });
    // Check that at least one call added an error message
    const calls = setMessagesMock.mock.calls;
    const addedErrorMsg = calls.some((call) => {
      const updater = call[0];
      if (typeof updater === "function") {
        const result = updater([]);
        return result.some(
          (m: { role: string; text: string }) =>
            m.role === "assistant" && /couldn't read/i.test(m.text),
        );
      }
      return false;
    });
    expect(addedErrorMsg).toBe(true);
  });

  it("(6) the explicit Transcript affordance button toggles the paste box", async () => {
    mountPanel();

    const transcriptBtn = screen.getByRole("button", { name: /paste a meeting transcript/i });
    expect(transcriptBtn).toBeInTheDocument();

    // Before click: no paste box
    expect(screen.queryByRole("textbox", { name: /paste transcript here/i })).toBeNull();

    await userEvent.click(transcriptBtn);

    // After click: paste box visible
    expect(screen.getByRole("textbox", { name: /paste transcript here/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /summarize/i })).toBeInTheDocument();

    // Cancel dismisses it
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await userEvent.click(cancelBtn);
    expect(screen.queryByRole("textbox", { name: /paste transcript here/i })).toBeNull();
  });
});
