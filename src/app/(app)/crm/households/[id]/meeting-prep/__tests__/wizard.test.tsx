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

  it("calls the draft route and advances to review on success", async () => {
    const draft = {
      brief: { briefing: "Hello.", sinceLastMeeting: [], talkingPoints: [], openQuestions: [], personalNotes: [] },
      agenda: { agendaItems: [{ title: "Review", description: "" }] },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ draft, data: { windowStart: "2026-04-01", lastMeetingDate: null } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Hello.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/crm/households/h1/meeting-prep/draft",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error state with retry (setup preserved) when the draft call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    render(
      <MeetingPrepWizard householdId="h1" householdName="The Coopers" hasPlanningClient={true} />,
    );
    fireEvent.change(screen.getByLabelText(/meeting focus/i), {
      target: { value: "Annual review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByText(/try again/i)).toBeTruthy());
    expect((screen.getByLabelText(/meeting focus/i) as HTMLTextAreaElement).value).toBe("Annual review");
  });
});
