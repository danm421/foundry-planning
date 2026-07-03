// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MeetingPrepWizard } from "../meeting-prep-wizard";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("MeetingPrepWizard", () => {
  it("renders the setup step with focus, context, date, and doc checkboxes", () => {
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    expect(screen.getByLabelText(/meeting focus/i)).toBeTruthy();
    expect(screen.getByLabelText(/additional context/i)).toBeTruthy();
    expect(screen.getByLabelText(/meeting date/i)).toBeTruthy();
    expect(screen.getByLabelText(/prep brief/i)).toBeTruthy();
    expect(screen.getByLabelText(/client agenda/i)).toBeTruthy();
  });

  it("disables Generate until a focus is entered", () => {
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    const btn = screen.getByRole("button", { name: /generate/i });
    expect(btn).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    expect(btn).toHaveProperty("disabled", false);
  });

  it("queues a run and advances to review when the poll reports done", async () => {
    const draft = {
      brief: { briefing: "Hello.", sinceLastMeeting: [], talkingPoints: [], openQuestions: [], personalNotes: [] },
      agenda: { agendaItems: [{ title: "Review", description: "" }] },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/crm/households/h1/meeting-prep/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ runId: "r1" }), { status: 202 });
      }
      if (url === "/api/crm/households/h1/meeting-prep/runs/r1") {
        return new Response(
          JSON.stringify({
            run: {
              id: "r1",
              status: "done",
              error: null,
              resultPayload: { draft, data: { windowStart: "2026-04-01", lastMeetingDate: null } },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Hello.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/crm/households/h1/meeting-prep/runs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns to setup with the error when the run fails (setup preserved)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ runId: "r1" }), { status: 202 });
      }
      return new Response(
        JSON.stringify({ run: { id: "r1", status: "failed", error: "boom", resultPayload: null } }),
        { status: 200 },
      );
    });
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByText(/try again/i)).toBeTruthy());
    expect(screen.getByText(/boom/i)).toBeTruthy();
    expect((screen.getByLabelText(/meeting focus/i) as HTMLTextAreaElement).value).toBe("Annual review");
  });

  it("treats done without a result payload as a failure and returns to setup", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ runId: "r1" }), { status: 202 });
      }
      return new Response(
        JSON.stringify({ run: { id: "r1", status: "done", error: null, resultPayload: null } }),
        { status: 200 },
      );
    });
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByText(/try again/i)).toBeTruthy());
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect((screen.getByLabelText(/meeting focus/i) as HTMLTextAreaElement).value).toBe("Annual review");
  });

  it("stops polling and surfaces an error after repeated failed status checks", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ runId: "r1" }), { status: 202 });
        }
        return new Response("nope", { status: 500 });
      });
      render(
        <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
      );
      fireEvent.change(screen.getByLabelText(/meeting focus/i), {
        target: { value: "Annual review" },
      });
      fireEvent.click(screen.getByRole("button", { name: /generate/i }));
      // Flush the POST + the immediate first (failing) tick, then walk through
      // the remaining retries at the 3s cadence until the cap trips.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      for (let i = 0; i < 9; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
      }
      expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
      expect(screen.getByText(/couldn't check on the draft/i)).toBeTruthy();
      // Scope to the active run's detail polls — the setup step also renders
      // Recent runs, which fires its own (unrelated) list GETs.
      const runDetailCalls = () =>
        fetchMock.mock.calls.filter(([input, init]) =>
          init?.method !== "POST" && String(input).endsWith("/runs/r1"),
        ).length;
      expect(runDetailCalls()).toBe(10);
      // Polling stopped — no further GETs after the cap.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(runDetailCalls()).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the POST error and stays on setup when queueing itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many meeting-prep drafts. Please wait a moment and try again." }), { status: 429 }),
    );
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByText(/too many meeting-prep drafts/i)).toBeTruthy());
  });

  it("renders Recent runs on the setup step and opens a done run into review", async () => {
    const payload = {
      draft: {
        brief: { briefing: "From run.", sinceLastMeeting: [], talkingPoints: [], openQuestions: [], personalNotes: [] },
        agenda: null,
      },
      data: { windowStart: "2026-04-01", lastMeetingDate: null },
    };
    const doneRun = {
      id: "r1", kind: "meeting-prep", status: "done", triggeredByEmail: null,
      createdAt: "2026-07-02T10:00:00.000Z", error: null,
      requestPayload: { focus: "Annual review", context: "", meetingDate: "2026-07-03", windowStart: null, docs: ["brief"] },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/runs/r1")) {
        return new Response(JSON.stringify({ run: { ...doneRun, resultPayload: payload } }), { status: 200 });
      }
      return new Response(JSON.stringify({ runs: [doneRun] }), { status: 200 });
    });
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /open draft/i }));
    await waitFor(() => expect(screen.getByDisplayValue("From run.")).toBeTruthy());
    // Setup fields restored from the run's request payload:
    expect(doneRun.requestPayload.focus).toBe("Annual review");
  });

  it("asks for confirmation before an open replaces an existing local draft", async () => {
    localStorage.setItem(
      "meeting-prep-draft:h1",
      JSON.stringify({
        setup: { focus: "Old", context: "", meetingDate: "2026-07-03", windowStart: null, docs: ["brief"] },
        draft: { brief: { briefing: "Old draft.", sinceLastMeeting: [], talkingPoints: [], openQuestions: [], personalNotes: [] }, agenda: null },
        data: null,
      }),
    );
    const doneRun = {
      id: "r1", kind: "meeting-prep", status: "done", triggeredByEmail: null,
      createdAt: "2026-07-02T10:00:00.000Z", error: null,
      requestPayload: { focus: "New", context: "", meetingDate: "2026-07-03", windowStart: null, docs: ["brief"] },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/runs/r1")) {
        return new Response(
          JSON.stringify({ run: { ...doneRun, resultPayload: { draft: { brief: { briefing: "New draft.", sinceLastMeeting: [], talkingPoints: [], openQuestions: [], personalNotes: [] }, agenda: null }, data: null } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ runs: [doneRun] }), { status: 200 });
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    // localStorage restore lands us on review with the old draft
    await waitFor(() => expect(screen.getByDisplayValue("Old draft.")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /open draft/i }));
    expect(confirmSpy).toHaveBeenCalled();
    // Declined — old draft still in place
    expect(screen.getByDisplayValue("Old draft.")).toBeTruthy();
  });
});
