// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaxAnalysisContent, type YearDetail } from "../tax-analysis-content";
import { FactsReviewForm } from "../facts-review-form";
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

const YEAR_URL = "/api/clients/c1/tax-returns/2025";

function readyList() {
  return {
    returns: [
      { taxYear: 2025, status: "ready", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
    ],
  };
}

function readyDetail(over: Record<string, unknown> = {}) {
  return {
    taxYear: 2025, status: "ready", facts: retireeMfj(), extractedFacts: retireeMfj(),
    warnings: [], analysis, documents: [], conflicts: [], provenance: {}, ...over,
  };
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
          documents: [],
          conflicts: [],
          provenance: {},
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

  it("shows the correct year's facts after switching between two needs_review years", async () => {
    const facts2024 = retireeMfj();
    facts2024.taxYear = 2024;
    facts2024.income.agi = 240000;
    const facts2023 = retireeMfj();
    facts2023.taxYear = 2023;
    facts2023.income.agi = 130000;

    fetchMock
      // 1. initial list — two needs_review years, 2024 first (selected by default)
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2024, status: "needs_review", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
            { taxYear: 2023, status: "needs_review", warningCount: 0, sourceFilename: "b.pdf", updatedAt: "2026-07-10T00:00:00Z" },
          ],
        }),
      )
      // 2. detail fetch for 2024
      .mockReturnValueOnce(
        jsonResponse({
          taxYear: 2024,
          status: "needs_review",
          facts: facts2024,
          extractedFacts: facts2024,
          warnings: [],
          analysis: null,
          documents: [],
          conflicts: [],
          provenance: {},
        }),
      )
      // 3. detail fetch for 2023 (after clicking the 2023 tab)
      .mockReturnValueOnce(
        jsonResponse({
          taxYear: 2023,
          status: "needs_review",
          facts: facts2023,
          extractedFacts: facts2023,
          warnings: [],
          analysis: null,
          documents: [],
          conflicts: [],
          provenance: {},
        }),
      );

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);

    // 2024's form is showing first, with its AGI.
    await waitFor(() => expect(screen.getByText(/AGI \$240,000/)).toBeTruthy());

    await user.click(screen.getByRole("tab", { name: /2023/ }));

    // Regression guard for correct year-switching: today this is also
    // enforced by the `!detailLoading && …` gate around FactsReviewForm
    // (confirmed via mount/unmount tracing: switching years fully unmounts
    // and remounts the form while detailLoading is true, so it always
    // reseeds from the freshly-fetched `detail` regardless of `key`). The
    // `key={detail.taxYear}` fix below is defense-in-depth for if that gate
    // is ever relaxed (e.g. a stale-while-revalidate UX that keeps the old
    // form visible during a background refetch) — see the FactsReviewForm-level
    // test below for a test that actually discriminates the fix.
    await waitFor(() => expect(screen.getByText(/AGI \$130,000/)).toBeTruthy());
    expect(screen.queryByText(/AGI \$240,000/)).toBeNull();
  });

  it("wires the second-read panel to the year's generate route and patches the panel from the response", async () => {
    const generated = {
      generatedAt: "2026-08-10T12:00:00.000Z",
      warnings: [],
      items: [
        {
          id: "sr-1",
          headline: "Form 8283 noncash gift may need a qualified appraisal",
          detail: "The packet includes a Form 8283 Section B.",
          form: "Form 8283", line: "Section B", quotedValue: "$28,500", dismissed: false,
        },
      ],
    };
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(jsonResponse(readyDetail({ secondRead: null, secondReadStale: false })))
      .mockReturnValueOnce(jsonResponse({ secondRead: generated, secondReadStale: false }));

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());
    const yearFetchesBefore = fetchMock.mock.calls.filter((c) => c[0] === YEAR_URL).length;

    await user.click(screen.getByRole("button", { name: /run ai second read/i }));

    await waitFor(() => expect(screen.getByText(/noncash gift/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`${YEAR_URL}/second-read`, { method: "POST" });
    // The handler patches `detail` from the response body. Re-fetching the year
    // would re-run the entire analysis to refresh one subordinate panel.
    expect(fetchMock.mock.calls.filter((c) => c[0] === YEAR_URL)).toHaveLength(yearFetchesBefore);
  });

  it("never generates on render — the AI fires only on the advisor's explicit click", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(jsonResponse(readyDetail({ secondRead: null, secondReadStale: false })));

    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());

    // Opening a year must never cost an AI call. Nothing has been clicked.
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/second-read")),
    ).toHaveLength(0);
    expect(screen.getByRole("button", { name: /run ai second read/i })).toBeTruthy();
  });

  it("does not patch a year the advisor navigated away from while the read was in flight", async () => {
    let resolvePost: (r: Response) => void = () => {};
    const heldPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const generated = {
      generatedAt: "2026-08-10T12:00:00.000Z",
      warnings: [],
      items: [
        {
          id: "sr-1",
          headline: "Form 8283 noncash gift may need a qualified appraisal",
          detail: "The packet includes a Form 8283 Section B.",
          form: "Form 8283", line: "Section B", quotedValue: "$28,500", dismissed: false,
        },
      ],
    };

    fetchMock
      .mockReturnValueOnce(
        jsonResponse({
          returns: [
            { taxYear: 2025, status: "ready", warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
            { taxYear: 2024, status: "ready", warningCount: 0, sourceFilename: "b.pdf", updatedAt: "2026-07-10T00:00:00Z" },
          ],
        }),
      )
      .mockReturnValueOnce(jsonResponse(readyDetail({ secondRead: null, secondReadStale: false })))
      // The generate call for 2025 — held open across the year switch below.
      .mockReturnValueOnce(heldPost)
      .mockReturnValueOnce(
        jsonResponse(readyDetail({ taxYear: 2024, secondRead: null, secondReadStale: false })),
      );

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /run ai second read/i }));
    await user.click(screen.getByRole("tab", { name: /2024/ }));
    await waitFor(() => expect(screen.getByText(/2024 tax analysis/i)).toBeTruthy());

    // 2025's read comes back while 2024 is on screen.
    await act(async () => {
      resolvePost(
        new Response(JSON.stringify({ secondRead: generated, secondReadStale: false }), {
          status: 200,
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /run ai second read/i })).not.toBeDisabled(),
    );
    // 2024 must not be wearing 2025's transcriptions — least of all flagged current.
    expect(screen.queryByText(/noncash gift/)).toBeNull();
    // Exact name, so "Run AI second read again" does NOT satisfy it: 2024 is
    // still in its no-read-yet state, which a merged blob would have flipped.
    expect(screen.getByRole("button", { name: "Run AI second read" })).toBeTruthy();
  });

  it("shows readable copy for the entitlement refusal instead of the machine code, and re-arms the button", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(jsonResponse(readyDetail({ secondRead: null, secondReadStale: false })))
      .mockReturnValueOnce(jsonResponse({ error: "ai_import_not_entitled" }, 403));

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /run ai second read/i }));

    await waitFor(() => expect(screen.getByText(/ai features aren't enabled/i)).toBeTruthy());
    // The raw code is advisor-facing jargon on a client-presentable screen.
    expect(screen.queryByText(/ai_import_not_entitled/)).toBeNull();
    // A failed run must not leave the panel wedged in its busy state.
    expect(screen.getByRole("button", { name: /run ai second read/i })).not.toBeDisabled();
  });

  // The read advertises itself as taking a minute and the route allows 300s, so
  // a browser or proxy timeout rejecting the fetch is an ordinary outcome — not
  // an exotic one. Unhandled, the advisor sees the busy line vanish and the
  // button re-arm, which is exactly what a successful empty read looks like.
  it("reports a rejected read instead of silently returning to idle", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(jsonResponse(readyDetail({ secondRead: null, secondReadStale: false })))
      // Lazy: an eagerly-built `Promise.reject` is unhandled between mock setup
      // and the call site, which Vitest reports as an error even though the
      // component handles it.
      .mockImplementationOnce(() => Promise.reject(new Error("Failed to fetch")));

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /run ai second read/i }));

    const panel = await screen.findByRole("region", { name: /ai second read/i });
    await waitFor(() => expect(within(panel).getByText(/failed to fetch/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /run ai second read/i })).not.toBeDisabled();
  });

  it("reports a rejected dismiss instead of leaving the item silently undismissed", async () => {
    const item = {
      id: "sr-1",
      headline: "Form 8283 noncash gift may need a qualified appraisal",
      detail: "The packet includes a Form 8283 Section B.",
      form: "Form 8283", line: "Section B", quotedValue: "$28,500", dismissed: false,
    };
    const generated = { generatedAt: "2026-08-10T12:00:00.000Z", warnings: [], items: [item] };
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(
        jsonResponse(readyDetail({ secondRead: generated, secondReadStale: false })),
      )
      // Lazy: an eagerly-built `Promise.reject` is unhandled between mock setup
      // and the call site, which Vitest reports as an error even though the
      // component handles it.
      .mockImplementationOnce(() => Promise.reject(new Error("Failed to fetch")));

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/noncash gift/)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /dismiss form 8283 noncash gift/i }));

    const panel = await screen.findByRole("region", { name: /ai second read/i });
    await waitFor(() => expect(within(panel).getByText(/failed to fetch/i)).toBeTruthy());
    // The dismissal did not land, so the item must still be there.
    expect(screen.getByText(/noncash gift/)).toBeTruthy();
  });

  // D-note: the page-level error banner is the FIRST child of a ~4700px page and
  // the panel is the LAST element on it. A second-read failure reported up there
  // is measurably off-screen for the advisor who clicked.
  it("puts a second-read failure inside the panel, not in the page-level banner", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(jsonResponse(readyDetail({ secondRead: null, secondReadStale: false })))
      .mockReturnValueOnce(jsonResponse({ error: "ai_import_not_entitled" }, 403));

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/2025 tax analysis/i)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /run ai second read/i }));

    const panel = await screen.findByRole("region", { name: /ai second read/i });
    await waitFor(() =>
      expect(within(panel).getByText(/ai features aren't enabled/i)).toBeTruthy(),
    );
    // Exactly once on the page — not duplicated into the unreachable banner.
    expect(screen.getAllByText(/ai features aren't enabled/i)).toHaveLength(1);
  });

  it("dismisses a second-read item by id and drops it from the panel", async () => {
    const item = {
      id: "sr-1",
      headline: "Form 8283 noncash gift may need a qualified appraisal",
      detail: "The packet includes a Form 8283 Section B.",
      form: "Form 8283", line: "Section B", quotedValue: "$28,500", dismissed: false,
    };
    const generated = { generatedAt: "2026-08-10T12:00:00.000Z", warnings: [], items: [item] };
    fetchMock
      .mockReturnValueOnce(jsonResponse(readyList()))
      .mockReturnValueOnce(
        jsonResponse(readyDetail({ secondRead: generated, secondReadStale: false })),
      )
      .mockReturnValueOnce(
        jsonResponse({ secondRead: { ...generated, items: [{ ...item, dismissed: true }] } }),
      );

    const user = userEvent.setup();
    render(<TaxAnalysisContent clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/noncash gift/)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /dismiss form 8283 noncash gift/i }));

    await waitFor(() => expect(screen.queryByText(/noncash gift/)).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(`${YEAR_URL}/second-read/sr-1`, { method: "DELETE" });
  });

  it("FactsReviewForm: a same-instance detail-prop change leaves stale facts in place unless keyed by taxYear (the mechanism tax-analysis-content.tsx's key={detail.taxYear} guards against)", () => {
    const detail2024: YearDetail = {
      taxYear: 2024,
      status: "needs_review",
      facts: (() => {
        const f = retireeMfj();
        f.taxYear = 2024;
        f.income.agi = 240000;
        return f;
      })(),
      extractedFacts: null,
      warnings: [],
      analysis: null,
      documents: [],
      conflicts: [],
      provenance: {},
    };
    const detail2023: YearDetail = {
      taxYear: 2023,
      status: "needs_review",
      facts: (() => {
        const f = retireeMfj();
        f.taxYear = 2023;
        f.income.agi = 130000;
        return f;
      })(),
      extractedFacts: null,
      warnings: [],
      analysis: null,
      documents: [],
      conflicts: [],
      provenance: {},
    };

    // No `key` — FactsReviewForm seeds `useState(detail.facts!)` once at mount,
    // so a same-instance rerender with a new `detail` prop keeps the old facts.
    const { rerender } = render(
      <FactsReviewForm clientId="c1" detail={detail2024} onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/AGI \$240,000/)).toBeTruthy();

    rerender(<FactsReviewForm clientId="c1" detail={detail2023} onSaved={vi.fn()} />);
    // BUG the fix guards against: still showing 2024's AGI even though
    // `detail` now points at 2023 — `save()` would PUT the stale 2024 facts
    // to the 2023 URL.
    expect(screen.getByText(/AGI \$240,000/)).toBeTruthy();
    expect(screen.queryByText(/AGI \$130,000/)).toBeNull();

    // Keying by taxYear — exactly what tax-analysis-content.tsx now does —
    // forces React to unmount the stale instance and mount a fresh one,
    // reseeding `facts` from the current `detail`.
    rerender(
      <FactsReviewForm key={detail2023.taxYear} clientId="c1" detail={detail2023} onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/AGI \$130,000/)).toBeTruthy();
    expect(screen.queryByText(/AGI \$240,000/)).toBeNull();
  });
});
