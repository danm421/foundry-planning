// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RecentRunsPanel } from "../recent-runs-panel";

const sampleRun = {
  id: "r1",
  kind: "presentation",
  status: "done",
  triggeredByEmail: "advisor@firm.com",
  createdAt: "2026-06-05T15:50:07.000Z",
  resultDocumentId: "doc1",
  error: null,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ householdId: "hh1", runs: [sampleRun] }),
    }),
  );
});

describe("RecentRunsPanel", () => {
  it("renders a done run with an Open link to the vault document", async () => {
    render(<RecentRunsPanel clientId="c1" householdId="hh1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText("Presentation")).toBeInTheDocument());
    expect(screen.getByText("advisor@firm.com")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: /open/i });
    expect(open).toHaveAttribute(
      "href",
      "/api/crm/households/hh1/documents/doc1",
    );
  });

  it("shows the empty state when there are no runs", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ householdId: "hh1", runs: [] }),
    });
    render(<RecentRunsPanel clientId="c1" householdId="hh1" refreshKey={0} />);
    await waitFor(() =>
      expect(screen.getByText(/no reports generated yet/i)).toBeInTheDocument(),
    );
  });

  it("a failed presentation shows Retry which re-POSTs the payload to /runs", async () => {
    const failed = {
      id: "r2", kind: "presentation", status: "failed",
      triggeredByEmail: "a@b.com", createdAt: "2026-06-05T15:50:07.000Z",
      resultDocumentId: null, error: "boom", requestPayload: { scenarioId: null, pages: [] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ householdId: "hh1", runs: [failed] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ runId: "r3" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<RecentRunsPanel clientId="c1" householdId="hh1" refreshKey={0} />);
    const retry = await screen.findByRole("button", { name: /retry/i });
    retry.click();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/c1/presentations/runs",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
