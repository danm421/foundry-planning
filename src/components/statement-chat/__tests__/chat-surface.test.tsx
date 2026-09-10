// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatSurface } from "../chat-surface";

const initialFiles = [{ serverFileId: "f1", name: "statement.pdf", documentType: "auto" }];

/** A real streaming Response whose body emits the given raw SSE frame strings. */
function makeFramedResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("ChatSurface", () => {
  // C9 / IMPORTANT 3(a): a rate-limit (or any non-2xx) response must render
  // the server's own error copy, never leave the advisor staring at a
  // spinner that never resolves.
  it("renders the server's error copy for a non-2xx response, not a spinner", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Rate limiting is not configured — extraction is disabled." }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(
      await screen.findByText("Rate limiting is not configured — extraction is disabled."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reading statements/i)).not.toBeInTheDocument();
  });

  // C9 / IMPORTANT 3(b): zero extracted accounts must render the plain
  // empty-state copy with a re-upload affordance, never an empty table.
  it("renders the empty-state copy — not a table — when done carries rows: []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFramedResponse([
        `data: ${JSON.stringify({
          type: "done",
          summary: "Read 1 statement covering 0 accounts.",
          caveats: [],
          rows: [],
          excluded: [],
        })}\n\n`,
      ]),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(await screen.findByText("No accounts found in these statements.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a real table when done carries rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFramedResponse([
        `data: ${JSON.stringify({
          type: "done",
          summary: "Read 1 statement covering 1 account.",
          caveats: [],
          rows: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
          excluded: [],
        })}\n\n`,
      ]),
    );

    render(<ChatSurface clientId="c1" importId="i1" initialFiles={initialFiles} />);
    fireEvent.click(screen.getByRole("button", { name: /extract statements/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("IRA")).toBeInTheDocument();
    expect(screen.queryByText("No accounts found in these statements.")).not.toBeInTheDocument();
  });
});
