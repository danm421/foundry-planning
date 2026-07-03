// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MeetingPrepRecentRuns } from "../meeting-prep-recent-runs";

beforeEach(() => {
  vi.restoreAllMocks();
});

const doneRun = {
  id: "r1",
  kind: "meeting-prep",
  status: "done",
  triggeredByEmail: "advisor@firm.com",
  createdAt: "2026-07-02T10:00:00.000Z",
  error: null,
  requestPayload: { focus: "Annual review", context: "", meetingDate: "2026-07-03", windowStart: null, docs: ["brief"] },
};

function mockList(runs: unknown[]) {
  return new Response(JSON.stringify({ runs }), { status: 200 });
}

describe("MeetingPrepRecentRuns", () => {
  it("renders an empty state when there are no runs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockList([]));
    render(
      <MeetingPrepRecentRuns householdId="h1" refreshKey={0} onOpenRun={vi.fn()} confirmReplace={() => true} />,
    );
    await waitFor(() => expect(screen.getByText(/no drafts generated yet/i)).toBeTruthy());
  });

  it("opens a done run via the detail route after confirmReplace passes", async () => {
    const onOpenRun = vi.fn();
    const payload = { draft: { brief: null, agenda: null }, data: null };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/runs/r1")) {
        return new Response(JSON.stringify({ run: { ...doneRun, resultPayload: payload } }), { status: 200 });
      }
      return mockList([doneRun]);
    });
    render(
      <MeetingPrepRecentRuns householdId="h1" refreshKey={0} onOpenRun={onOpenRun} confirmReplace={() => true} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /open draft/i }));
    await waitFor(() =>
      expect(onOpenRun).toHaveBeenCalledWith(payload, doneRun.requestPayload),
    );
  });

  it("does not open when confirmReplace declines", async () => {
    const onOpenRun = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockList([doneRun]));
    render(
      <MeetingPrepRecentRuns householdId="h1" refreshKey={0} onOpenRun={onOpenRun} confirmReplace={() => false} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /open draft/i }));
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it("retries a failed run by re-POSTing its request payload", async () => {
    const failed = { ...doneRun, id: "r2", status: "failed", error: "boom" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ runId: "r3" }), { status: 202 });
      }
      return mockList([failed]);
    });
    render(
      <MeetingPrepRecentRuns householdId="h1" refreshKey={0} onOpenRun={vi.fn()} confirmReplace={() => true} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/crm/households/h1/meeting-prep/runs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(failed.requestPayload),
        }),
      ),
    );
  });
});
