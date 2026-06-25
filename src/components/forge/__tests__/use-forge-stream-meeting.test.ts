// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  parseForgeSse,
  useForgeStream,
  type ForgeSseEvent,
  type MeetingReviewResume,
} from "../use-forge-stream";

/** Build a streaming Response from an array of raw SSE frame strings. */
function makeFramedResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Minimal done-only streaming Response. */
function makeDoneResponse(): Response {
  return makeFramedResponse([`data: {"type":"done"}\n\n`]);
}

/** Feed chunks through the stateful boundary parser. */
function drain(chunks: string[]): ForgeSseEvent[] {
  let buffer = "";
  const out: ForgeSseEvent[] = [];
  for (const chunk of chunks) {
    buffer += chunk;
    const it = parseForgeSse(buffer);
    let next = it.next();
    while (!next.done) {
      out.push(next.value);
      next = it.next();
    }
    buffer = next.value as string;
  }
  return out;
}

const validArgs = { message: "Summarize the meeting", scenarioId: "base" };

const meetingReviewFrame = JSON.stringify({
  type: "meeting_review",
  summaryTitle: "Q1 Planning Review",
  summary: "We discussed the client's retirement goals.",
  meetingDate: "2026-06-20",
  proposedTasks: [
    { title: "Update projections", description: "Run new Monte Carlo", priority: "high", dueDate: "2026-07-01" },
    { title: "Send summary", description: "Email meeting notes", priority: "med", dueDate: null },
  ],
});

// ---------------------------------------------------------------------------
// parseForgeSse — meeting_review frame
// ---------------------------------------------------------------------------

describe("parseForgeSse — meeting_review frame", () => {
  it("parses a meeting_review frame with proposedTasks", () => {
    const events = drain([`data: ${meetingReviewFrame}\n\n`]);
    expect(events).toEqual([
      {
        type: "meeting_review",
        summaryTitle: "Q1 Planning Review",
        summary: "We discussed the client's retirement goals.",
        meetingDate: "2026-06-20",
        proposedTasks: [
          { title: "Update projections", description: "Run new Monte Carlo", priority: "high", dueDate: "2026-07-01" },
          { title: "Send summary", description: "Email meeting notes", priority: "med", dueDate: null },
        ],
      },
    ]);
  });

  it("parses a meeting_review frame with null meetingDate", () => {
    const frame = JSON.stringify({
      type: "meeting_review",
      summaryTitle: "Unknown date",
      summary: "No date available.",
      meetingDate: null,
      proposedTasks: [],
    });
    const events = drain([`data: ${frame}\n\n`]);
    expect(events[0]).toMatchObject({ type: "meeting_review", meetingDate: null, proposedTasks: [] });
  });
});

// ---------------------------------------------------------------------------
// useForgeStream — meeting_review SSE event populates pendingMeetingReview
// ---------------------------------------------------------------------------

describe("useForgeStream — meeting_review event", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeDoneResponse()));
  });

  it("populates pendingMeetingReview when a meeting_review frame arrives", async () => {
    const frames = [
      `data: ${meetingReviewFrame}\n\n`,
      `data: {"type":"done"}\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFramedResponse(frames)));

    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    expect(result.current.pendingMeetingReview).toEqual({
      summaryTitle: "Q1 Planning Review",
      summary: "We discussed the client's retirement goals.",
      meetingDate: "2026-06-20",
      proposedTasks: [
        { title: "Update projections", description: "Run new Monte Carlo", priority: "high", dueDate: "2026-07-01" },
        { title: "Send summary", description: "Email meeting notes", priority: "med", dueDate: null },
      ],
    });
    expect(result.current.status).toBe("done");
  });

  it("starts as null and stays null when no meeting_review frame arrives", async () => {
    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    expect(result.current.pendingMeetingReview).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useForgeStream — send includes pendingTranscriptId in fetch body
// ---------------------------------------------------------------------------

describe("useForgeStream.send — pendingTranscriptId", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeDoneResponse()));
  });

  it("includes pendingTranscriptId in the fetch body when provided", async () => {
    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send({ ...validArgs, pendingTranscriptId: "tx_99" });
    });

    const body = JSON.parse(
      (globalThis.fetch as Mock).mock.calls[0][1].body as string,
    );
    expect(body.pendingTranscriptId).toBe("tx_99");
  });

  it("omits pendingTranscriptId when not provided", async () => {
    const { result } = renderHook(() => useForgeStream("client_42"));

    await act(async () => {
      await result.current.send(validArgs);
    });

    const body = JSON.parse(
      (globalThis.fetch as Mock).mock.calls[0][1].body as string,
    );
    // key may be present as undefined or absent — either way the value is falsy
    expect(body.pendingTranscriptId == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useForgeStream — resumeMeetingReview
// ---------------------------------------------------------------------------

describe("useForgeStream — resumeMeetingReview", () => {
  const meetingResumePayload: MeetingReviewResume = {
    approved: true,
    summaryTitle: "Q1 Planning Review",
    summary: "We discussed the client's retirement goals.",
    meetingDate: "2026-06-20",
    tasks: [
      { title: "Update projections", description: "Run new Monte Carlo", priority: "high", dueDate: "2026-07-01" },
    ],
  };

  it("clears pendingMeetingReview optimistically and POSTs meetingReview to /forge/resume", async () => {
    const frames = [
      `data: ${meetingReviewFrame}\n\n`,
      `data: {"type":"done"}\n\n`,
    ];
    const fetchMock = vi
      .fn()
      // First call: send — returns the meeting_review frame
      .mockResolvedValueOnce(makeFramedResponse(frames))
      // Second call: resumeMeetingReview — returns a done stream
      .mockResolvedValueOnce(makeDoneResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useForgeStream("client_42"));

    // Establish a conversationId + populate pendingMeetingReview
    act(() => {
      result.current.setConversationId("conv_meeting_1");
    });

    await act(async () => {
      await result.current.send(validArgs);
    });
    expect(result.current.pendingMeetingReview).not.toBeNull();

    // Now call resumeMeetingReview
    await act(async () => {
      await result.current.resumeMeetingReview(meetingResumePayload);
    });

    // pendingMeetingReview must be cleared
    expect(result.current.pendingMeetingReview).toBeNull();

    // Verify the POST body
    const resumeBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(resumeBody.conversationId).toBe("conv_meeting_1");
    expect(resumeBody.meetingReview).toEqual(meetingResumePayload);

    // Stream was consumed and status resolved
    expect(result.current.status).toBe("done");
  });

  it("does nothing when conversationId is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeDoneResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useForgeStream("client_42"));
    // no conversationId set

    await act(async () => {
      await result.current.resumeMeetingReview(meetingResumePayload);
    });

    // fetch should NOT have been called (resumeMeetingReview returned early)
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the correct client URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeDoneResponse()) // send
      .mockResolvedValueOnce(makeDoneResponse()); // resume
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useForgeStream("client_XYZ"));
    act(() => { result.current.setConversationId("conv_abc"); });

    await act(async () => {
      await result.current.send(validArgs);
    });

    await act(async () => {
      await result.current.resumeMeetingReview(meetingResumePayload);
    });

    const [resumeUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(resumeUrl).toBe("/api/clients/client_XYZ/forge/resume");
  });
});
