// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TaxAnalysisContent } from "../tax-analysis-content";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe("TaxAnalysisContent", () => {
  it("shows the empty state when no returns exist", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ returns: [] }));
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() =>
      expect(screen.getByText(/upload a filed tax return/i)).toBeTruthy(),
    );
  });

  it("renders year tabs and loads the newest year's detail", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2025, status: "ready", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
            { taxYear: 2024, status: "ready", warningCount: 0, sourceFilename: "b.pdf", updatedAt: "2026-07-10T00:00:00Z" },
          ],
        }),
      )
      .mockReturnValueOnce(
        jsonResponse({ taxYear: 2025, status: "ready", facts: null, extractedFacts: null, warnings: [], analysis: null }),
      );
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /2025/ })).toBeTruthy());
    expect(screen.getByRole("tab", { name: /2024/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/clients/c1/tax-returns/2025", expect.anything());
  });
});
