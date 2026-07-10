// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaxAnalysisContent } from "../tax-analysis-content";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj } from "@/lib/tax-analysis/__tests__/fixtures";

// Task 14 replaced the Task-13 placeholders ("Report 2025" / "Review 2025")
// with the real TaxReportView / FactsReviewForm, which read actual analysis
// and facts fields — a bare `{} as never` now crashes them. These tests use
// a realistic MFJ-retiree fixture (same one the report-view unit test uses)
// so the D1/D2 state-machine assertions below still exercise real renders.
const resolver = createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
const analysis = buildTaxAnalysis({ facts: retireeMfj(), prior: null, resolver, primaryAge: 72, spouseAge: 72 });

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

  it("D2: renders the report (not the corrupt notice) when facts is valid but extractedFacts is stale/corrupt", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2025, status: "ready", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
          ],
        }),
      )
      .mockReturnValueOnce(
        jsonResponse({
          taxYear: 2025,
          status: "ready",
          facts: retireeMfj(),
          extractedFacts: null,
          warnings: [],
          analysis,
          factsParseError: true,
        }),
      );
    render(<TaxAnalysisContent clientId="c1" />);
    // facts is non-null (valid), so the corrupt-notice guard (`!detail.facts`)
    // stays false even with factsParseError true — the report still renders.
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());
    expect(screen.queryByText(/couldn.t be read/i)).toBeNull();
  });

  it("D2: renders the corrupt notice when facts is null", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2025, status: "needs_review", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
          ],
        }),
      )
      .mockReturnValueOnce(
        jsonResponse({
          taxYear: 2025,
          status: "needs_review",
          facts: null,
          extractedFacts: null,
          warnings: [],
          analysis: null,
          factsParseError: true,
        }),
      );
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() =>
      expect(screen.getByText(/this year.s data couldn.t be read/i)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /delete.*re-upload/i })).toBeTruthy();
  });

  it("D1: replacing the currently-selected year re-fetches its detail instead of reusing the stale one", async () => {
    fetchMock
      // 1. initial list
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2025, status: "ready", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
          ],
        }),
      )
      // 2. initial detail fetch for 2025
      .mockReturnValueOnce(
        jsonResponse({
          taxYear: 2025,
          status: "ready",
          facts: retireeMfj(),
          extractedFacts: retireeMfj(),
          warnings: [],
          analysis,
        }),
      )
      // 3. POST upload (replace) response
      .mockReturnValueOnce(jsonResponse({ taxYear: 2025, status: "needs_review", warnings: [] }))
      // 4. list refresh after upload
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2025, status: "needs_review", warningCount: 0, sourceFilename: "r.pdf", updatedAt: "2026-07-10T01:00:00Z" },
          ],
        }),
      )
      // 5. detail re-fetch for 2025 (post-replace, same year)
      .mockReturnValueOnce(
        jsonResponse({
          taxYear: 2025,
          status: "needs_review",
          facts: retireeMfj(),
          extractedFacts: retireeMfj(),
          warnings: [],
          analysis: null,
          factsParseError: false,
        }),
      );

    const user = userEvent.setup();
    const { container } = render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());

    const detailUrl = "/api/clients/c1/tax-returns/2025";
    const detailCallsBefore = fetchMock.mock.calls.filter((c) => c[0] === detailUrl).length;
    expect(detailCallsBefore).toBe(1);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "r.pdf", { type: "application/pdf" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      const detailCallsAfter = fetchMock.mock.calls.filter((c) => c[0] === detailUrl).length;
      expect(detailCallsAfter).toBe(2);
    });

    // Review branch should now render for the reopened 2025 return, proving
    // the detail state actually refreshed rather than staying on the stale
    // "ready" report. Assert on a real FactsReviewForm field label (the
    // report heading is gone) rather than the old placeholder text.
    await waitFor(() => expect(screen.getByText(/wages \(1a\)/i)).toBeTruthy());
    expect(screen.queryByText(/2025 tax analysis/i)).toBeNull();
  });
});
