// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { PlanVsReturnContent } from "../plan-vs-return-content";
import type { Reconciliation, Suggestion } from "@/lib/tax-reconciliation/types";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const wages: Suggestion = {
  id: "income.wages.w2.0",
  section: "income",
  kind: "update",
  status: "open",
  headline: "Acme paid $165,000 in 2025; the plan's Acme Corp is $150,000 in 2025 dollars.",
  meaning: "The W-2 is the actual figure.",
  returnFigure: {
    label: "Acme · box 1",
    amount: 165_000,
    display: "$165,000",
    lineRefs: [{ form: "W-2", line: "Box 1", label: "", amount: 165_000 }],
  },
  planFigure: { label: "Acme Corp", amount: 150_000, display: "$150,000", year: 2026 },
  delta: { amount: -15_000, display: "Plan is $15,000 short", tone: "short" },
  action: {
    label: "Set salary to $165,000",
    describe: "Sets Acme Corp to $165,000 (2025 dollars)",
    amountEditable: true,
    defaultAmount: 165_000,
    target: { kind: "income.update", incomeId: "i1", patch: {}, amountField: "annualAmount" },
  },
};

const create: Suggestion = {
  ...wages,
  id: "income.wages.w2.1.create",
  headline: "Globex is on the return but not in the plan.",
  action: {
    ...wages.action!,
    label: "Add salary of $90,000",
    defaultAmount: 90_000,
    ownerChoices: ["client", "spouse"],
    target: { kind: "income.create", input: {}, amountField: "annualAmount", ownerField: "owner" },
  },
};

const bundle = (over: Partial<Reconciliation> = {}): Reconciliation => ({
  taxYear: 2025,
  planYear: 2026,
  planStartYear: 2026,
  status: "ready",
  overview: {
    totalIncome: { return: 200_000, plan: 198_000 },
    federalTax: { return: 30_000, plan: 28_000 },
    agi: { return: 190_000, plan: 188_000 },
    effectiveRate: { return: 0.158, plan: 0.149 },
    openCount: 2,
    dismissedCount: 0,
    inLineCount: 2,
  },
  sections: [{ id: "income", title: "Income", items: [wages, create] }],
  checks: [
    {
      id: "household.filingStatus",
      label: "Filing status",
      returnDisplay: "Married filing jointly",
      planDisplay: "Married filing jointly",
    },
    {
      id: "income.wages.w2.2",
      label: "Wages · Initech",
      returnDisplay: "$40,000",
      planDisplay: "$40,000",
    },
  ],
  dismissed: [],
  // What `notes` actually carries now: only what the page cannot know for
  // itself. Units are the renderer's job — see build.ts.
  notes: ["The wages checks could not run, so nothing on this page reflects them."],
  dismissalsUnavailable: false,
  ...over,
});

const list = (status = "ready") => ({
  returns: [
    { taxYear: 2025, status, warningCount: 0, sourceFilename: "a.pdf", updatedAt: "2026-07-10T00:00:00Z" },
    { taxYear: 2024, status: "ready", warningCount: 0, sourceFilename: "b.pdf", updatedAt: "2026-07-10T00:00:00Z" },
  ],
});

/** The tile the open count lives in — located by its own label, so a swapped
 *  tile can't satisfy the assertion. */
function openTile(): HTMLElement {
  return screen.getByText(/open suggestions/i).closest("div")!;
}

describe("PlanVsReturnContent", () => {
  it("renders year tabs, the overview strip, the cards, the note, and the in-line list", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);

    // The AGI tile only exists once the bundle has landed, so waiting on it
    // covers both fetches.
    await screen.findByText("$190,000");
    expect(screen.getByRole("tab", { name: /2025/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /2024/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/tax-returns/2025/reconcile",
      expect.anything(),
    );
    expect(screen.getByText(/what the 2025 return says/i)).toBeTruthy();
    // CHANGE 1: the caps and tracking belong to the eyebrow, not to the row —
    // the row also holds the FieldTooltip, whose panel sets only size and
    // leading and would otherwise render the page's one mechanism sentence in
    // ALL CAPS at 0.08em tracking inside a 224px box.
    // CHANGE 3: the units explanation exists once, on the strip's tooltip. It
    // used to print again one line below as a builder note, in different words.
    expect(screen.getAllByText(/restated in 2025 dollars/i)).toHaveLength(1);
    expect(screen.queryByText(/shown in 2025 dollars/i)).toBeNull();
    const eyebrow = screen.getByText(/^Return 2025 · Plan 2026$/);
    expect(eyebrow.className).toContain("uppercase");
    expect(eyebrow.parentElement!.className).not.toContain("uppercase");
    expect(eyebrow.parentElement!.className).not.toContain("tracking-");
    expect(screen.getByText("$190,000")).toBeTruthy(); // AGI tile (return)
    // CHANGE 1: every eyebrow on the strip shares the numeral face, so no tile
    // label sits in Inter beside a mono neighbour.
    for (const label of ["Total income", "Federal tax", "AGI", "Open suggestions"]) {
      expect(screen.getByText(label).className).toContain("tabular");
    }
    expect(within(openTile()).getByText("2")).toBeTruthy();
    expect(screen.getByText(/acme paid \$165,000/i)).toBeTruthy();
    expect(screen.getByText(/globex is on the return/i)).toBeTruthy();
    // CHANGE 5: notes are disclosures, so they render above the cards — this
    // one says a whole rule could not run.
    const note = screen.getByText(/wages checks could not run/i);
    const firstCard = screen.getByText(/acme paid \$165,000/i);
    expect(note.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // CHANGE 4/10: the toggles are btn-ghost, and each IS its section heading,
    // so the cards and table inside sit under an h3 rather than skipping a level.
    const inLineToggle = screen.getByRole("button", { name: /already in line \(2\)/i });
    expect(inLineToggle.className).toContain("btn-ghost");
    expect(inLineToggle.className).not.toContain("underline");
    expect(inLineToggle.closest("h3")).toBeTruthy();
    await userEvent.click(inLineToggle);
    const table = screen.getByRole("table");
    // CHANGE 1/3: all three headers share one face — a mono year beside an
    // Inter "Plan" is a visible split in the same row.
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header.className).toContain("tabular");
    }
    expect(within(table).getByText("Filing status")).toBeTruthy();
    // Mono is for numerals only: a filing status rendered in the numeral face
    // is a brand violation on a screen an advisor shows a client as-is.
    for (const cell of within(table).getAllByText("Married filing jointly")) {
      expect(cell.className).not.toContain("tabular");
    }
    for (const cell of within(table).getAllByText("$40,000")) {
      expect(cell.className).toContain("tabular");
    }
  });

  it("gates a needs_review year and honours ?year=", async () => {
    fetchMock.mockReturnValueOnce(json(list("needs_review")));
    render(<PlanVsReturnContent clientId="c1" initialYear={2025} scenarioIgnored={false} />);

    await waitFor(() => expect(screen.getByText(/finish reviewing the 2025 return/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: /tax analysis/i }).getAttribute("href")).toBe(
      "/clients/c1/details/tax-analysis",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the 409 message and the scenario note", async () => {
    fetchMock
      .mockReturnValueOnce(json(list()))
      .mockReturnValueOnce(
        json(
          { error: "no_plan", message: "This household has no base-case plan to compare against yet." },
          409,
        ),
      );
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored />);

    await waitFor(() => expect(screen.getByText(/no base-case plan/i)).toBeTruthy());
    expect(screen.getByText(/compares the base case/i)).toBeTruthy();
    // R60/Ruling 7: the machine code never reaches the advisor.
    expect(screen.queryByText(/no_plan/)).toBeNull();
  });

  it("offers the upload path when the client has no return on file", async () => {
    fetchMock.mockReturnValueOnce(json({ returns: [] }));
    render(<PlanVsReturnContent clientId="c2" scenarioIgnored={false} />);
    await waitFor(() => expect(screen.getByRole("link", { name: /upload a return/i })).toBeTruthy());
    expect(screen.getByRole("link", { name: /upload a return/i }).getAttribute("href")).toBe(
      "/clients/c2/details/tax-analysis",
    );
  });

  it("applies with the edited amount and the chosen owner, announces it, and refreshes the strip", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);

    const card = (await screen.findByText(/globex is on the return/i)).closest("article")!;
    await userEvent.click(within(card).getByRole("radio", { name: /spouse/i }));
    const amount = within(card).getByRole("textbox", { name: /amount/i });
    await userEvent.clear(amount);
    await userEvent.type(amount, "95000");

    fetchMock.mockReturnValueOnce(
      json({
        applied: {
          suggestionId: "income.wages.w2.1.create",
          summary: 'Adds a salary "Globex" of $95,000 (2025 dollars)',
        },
        reconciliation: bundle({
          sections: [{ id: "income", title: "Income", items: [wages] }],
          overview: { ...bundle().overview, openCount: 1 },
        }),
      }),
    );
    await userEvent.click(within(card).getByRole("button", { name: /add salary/i }));

    // R58: the applied card is GONE from the fresh bundle, so the confirmation
    // lives in a page-level live region, not inside the card.
    const live = await screen.findByRole("status");
    await waitFor(() =>
      expect(within(live).getByText(/updated — adds a salary "globex" of \$95,000/i)).toBeTruthy(),
    );
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByText(/globex is on the return/i)).toBeNull();

    const [, init] = fetchMock.mock.calls[2];
    expect(JSON.parse(init.body)).toEqual({
      suggestionId: "income.wages.w2.1.create",
      amount: 95000,
      owner: "spouse",
    });
    expect(within(openTile()).getByText("1")).toBeTruthy();
    // R59: the row link is built from the route param, not parsed out of an
    // optional href — this suggestion carries no `link` at all.
    const rowLink = within(live).getByRole("link", { name: /inflows & outflows/i });
    expect(rowLink.getAttribute("href")).toBe("/clients/c1/details/income-expenses");
  });

  it("R60: surfaces the server's own message when an apply fails", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const card = (await screen.findByText(/acme paid/i)).closest("article")!;

    fetchMock.mockReturnValueOnce(
      json({ error: "not_found", message: "That salary is no longer in the plan." }, 404),
    );
    await userEvent.click(within(card).getByRole("button", { name: /set salary/i }));

    await waitFor(() => expect(screen.getByText(/that salary is no longer in the plan/i)).toBeTruthy());
    // The generic fallback must NOT have replaced it, and the code must not leak.
    expect(screen.queryByText(/the update didn't apply/i)).toBeNull();
    expect(screen.queryByText(/not_found/)).toBeNull();
  });

  it("Ruling 9: the first click disables the button, so a double-click writes once", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const card = (await screen.findByText(/acme paid/i)).closest("article")!;

    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));

    const apply = within(card).getByRole("button", { name: /set salary/i });
    await userEvent.click(apply);
    expect(apply).toBeDisabled();
    expect(card).toHaveAttribute("aria-busy", "true");
    await userEvent.click(apply);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    release(
      new Response(
        JSON.stringify({
          applied: { suggestionId: wages.id, summary: "Sets Acme Corp to $165,000" },
          reconciliation: bundle({ sections: [], overview: { ...bundle().overview, openCount: 0 } }),
        }),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(screen.getByText(/updated — sets acme corp/i)).toBeTruthy());
  });

  it("takes one write at a time, so no other card can be clicked into the void", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const acme = (await screen.findByText(/acme paid/i)).closest("article")!;
    const globex = screen.getByText(/globex is on the return/i).closest("article")!;

    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));
    await userEvent.click(within(acme).getByRole("button", { name: /set salary/i }));

    // The other card is inert while the write runs — but only the acting card
    // reports itself busy to assistive tech.
    expect(within(globex).getByRole("button", { name: /add salary/i })).toBeDisabled();
    expect(within(globex).getByRole("textbox", { name: /amount/i })).toBeDisabled();
    expect(globex).toHaveAttribute("aria-busy", "false");
    await userEvent.click(within(globex).getByRole("button", { name: /add salary/i }));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    release(
      new Response(
        JSON.stringify({
          applied: { suggestionId: wages.id, summary: "Sets Acme Corp to $165,000" },
          reconciliation: bundle(),
        }),
        { status: 200 },
      ),
    );
    await waitFor(() =>
      expect(within(globex).getByRole("button", { name: /add salary/i })).not.toBeDisabled(),
    );
  });

  it("dismisses into the Not applicable list and restores from it", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const card = (await screen.findByText(/acme paid/i)).closest("article")!;

    fetchMock.mockReturnValueOnce(
      json({
        reconciliation: bundle({
          sections: [{ id: "income", title: "Income", items: [create] }],
          dismissed: [{ ...wages, status: "dismissed" }],
          overview: { ...bundle().overview, openCount: 1, dismissedCount: 1 },
        }),
      }),
    );
    await userEvent.click(within(card).getByRole("button", { name: /not applicable/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /not applicable \(1\)/i })).toBeTruthy(),
    );
    expect(fetchMock.mock.calls[2][0]).toBe("/api/clients/c1/tax-returns/2025/reconcile/dismiss");
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");

    await userEvent.click(screen.getByRole("button", { name: /not applicable \(1\)/i }));
    fetchMock.mockReturnValueOnce(json({ reconciliation: bundle() }));
    await userEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
  });

  it("explains a 503 rather than showing a machine code", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const card = (await screen.findByText(/acme paid/i)).closest("article")!;

    fetchMock.mockReturnValueOnce(json({ error: "dismissals_unavailable" }, 503));
    await userEvent.click(within(card).getByRole("button", { name: /not applicable/i }));

    const live = screen.getByRole("status");
    // The notice reports THIS click; the page-level line explains the state.
    await waitFor(() =>
      expect(within(live).getByText(/that card couldn't be set aside/i)).toBeTruthy(),
    );
    expect(within(live).queryByText(/dismissals_unavailable/)).toBeNull();
    // Deployment state is not something an advisor can act on, and this screen
    // is shown to clients as it stands.
    expect(within(live).queryByText(/update|deploy|migrat/i)).toBeNull();

    // …and the button latches off, so the same wall cannot be hit again.
    expect(within(card).getByRole("button", { name: /not applicable/i })).toBeDisabled();
    // The explanation appears ONCE on the page, not beside every dead button.
    const reason = screen.getAllByText(/setting cards aside isn't available right now/i);
    expect(reason).toHaveLength(1);
    expect(within(card).queryByText(/setting cards aside/i)).toBeNull();
  });

  it("moves focus to the confirmation, which replaced the card the button was on", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const card = (await screen.findByText(/acme paid/i)).closest("article")!;

    fetchMock.mockReturnValueOnce(
      json({
        applied: { suggestionId: wages.id, summary: "Sets Acme Corp to $165,000" },
        reconciliation: bundle({ sections: [{ id: "income", title: "Income", items: [create] }] }),
      }),
    );
    await userEvent.click(within(card).getByRole("button", { name: /set salary/i }));

    const live = screen.getByRole("status");
    await waitFor(() => expect(document.activeElement).toBe(live));
    expect(live.getAttribute("tabindex")).toBe("-1");
  });

  it("ignores a bundle that arrives after the advisor moved to another year", async () => {
    let releaseStale!: (r: Response) => void;
    fetchMock
      .mockReturnValueOnce(json(list()))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { releaseStale = resolve; }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    await screen.findByRole("tab", { name: /2024/ });

    // Switch to 2024 while 2025's bundle is still in flight, then let 2025 land.
    fetchMock.mockReturnValueOnce(
      json({ reconciliation: bundle({ taxYear: 2024, sections: [], notes: ["2024 note"] }) }),
    );
    await userEvent.click(screen.getByRole("tab", { name: /2024/ }));
    releaseStale(new Response(JSON.stringify({ reconciliation: bundle() }), { status: 200 }));

    await waitFor(() => expect(screen.getByText("2024 note")).toBeTruthy());
    // 2025's late answer must not have painted over 2024's.
    expect(screen.queryByText(/acme paid/i)).toBeNull();
    expect(screen.getByText(/nothing to update/i)).toBeTruthy();
  });

  it("reloads on a stale apply and says so", async () => {
    fetchMock.mockReturnValueOnce(json(list())).mockReturnValueOnce(json({ reconciliation: bundle() }));
    render(<PlanVsReturnContent clientId="c1" scenarioIgnored={false} />);
    const card = (await screen.findByText(/acme paid/i)).closest("article")!;

    fetchMock.mockReturnValueOnce(
      json({ error: "stale", reconciliation: bundle({ sections: [] }) }, 409),
    );
    await userEvent.click(within(card).getByRole("button", { name: /set salary/i }));

    await waitFor(() =>
      expect(screen.getByText(/the plan changed since this was suggested/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/acme paid/i)).toBeNull();
    expect(screen.getByText(/nothing to update/i)).toBeTruthy();
  });
});
