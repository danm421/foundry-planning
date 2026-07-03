// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
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
});
