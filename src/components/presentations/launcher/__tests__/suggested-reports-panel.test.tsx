// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PRESENTATION_PAGES, type PresentationPageId } from "@/components/presentations/registry";
import type { ReportSuggestion } from "@/lib/presentations/suggestions/score-reports";
import { SuggestedReportsPanel, suggestedOverride } from "../suggested-reports-panel";

const SUGGESTIONS: ReportSuggestion[] = [
  { pageId: "rothConversion", score: 96, reason: "This plan converts $312k to Roth, 2027–2031.", optionsPatch: { scenarioId: "s1" } },
  { pageId: "medicareSummary", score: 90, reason: "The plan pays $48k in Medicare income surcharges (IRMAA), starting 2031." },
  { pageId: "estateSummary", score: 86, reason: "The plan projects $2.1M in estate tax." },
  { pageId: "retirementSummary", score: 82, reason: "Retirement is 4 years away." },
  { pageId: "monteCarlo", score: 54, reason: "Retirement is 4 years away — how sure is the plan?" },
  { pageId: "balanceSheet", score: 40, reason: "Net worth, assets and debts as of today." },
  { pageId: "clientProfile", score: 30, reason: "Introduces the household before the numbers." },
];

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ suggestions: SUGGESTIONS }), { status: 200 }));
  global.fetch = fetchMock as never;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderPanel(over: Partial<React.ComponentProps<typeof SuggestedReportsPanel>> = {}) {
  const props = {
    clientId: "c1",
    deckScenario: "base",
    deckPages: [] as Array<{ pageId: PresentationPageId; options: unknown }>,
    scenarios: [{ id: "s1", name: "Roth ladder", isBaseCase: false }],
    snapshots: [],
    onAdd: vi.fn(),
    onPreview: vi.fn(),
    ...over,
  };
  return { props, ...render(<SuggestedReportsPanel {...props} />) };
}

const cardTitles = () => screen.getAllByRole("article").map((a) => within(a).getByRole("heading").textContent);

describe("suggestedOverride", () => {
  it("pins a page that follows the deck to the panel's plan when the two differ", () => {
    expect(suggestedOverride("medicareSummary", {}, "s1", "base")).toBe("s1");
    expect(suggestedOverride("incomeTaxBracketFederal", { range: "rothConversionYears", showCallout: true }, "snap:x", "base")).toBe("snap:x");
  });

  it("does not pin when the panel follows the deck's plan", () => {
    expect(suggestedOverride("medicareSummary", {}, "s1", "s1")).toBeUndefined();
  });

  it("never pins a page that carries its plan in its own settings, or one fixed to Base Case", () => {
    expect(suggestedOverride("planStory", PRESENTATION_PAGES.planStory.defaultOptions, "s1", "base")).toBeUndefined();
    expect(suggestedOverride("rothConversion", { scenarioId: "s1" }, "s1", "base")).toBeUndefined();
    expect(suggestedOverride("earlyYearsStanding", {}, "s1", "base")).toBeUndefined();
  });
});

describe("SuggestedReportsPanel", () => {
  it("shows the four best matches for the deck's plan, with their reasons", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    expect(fetchMock).toHaveBeenCalledWith("/api/clients/c1/presentations/suggestions?plan=base", expect.anything());
    expect(cardTitles()).toContain("Roth Conversion Strategy");
    expect(screen.getByText("$312k")).toHaveClass("tabular");
  });

  it("adds a suggestion with its own settings laid over the page defaults", async () => {
    const { props } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add Roth Conversion Strategy to the deck" }));
    expect(props.onAdd).toHaveBeenCalledWith("rothConversion", expect.objectContaining({ scenarioId: "s1" }), undefined);
  });

  it("adds a page pinned to the plan picked in the panel", async () => {
    const { props } = renderPanel({ deckScenario: "base" });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Plan to base suggestions on"), { target: { value: "s1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Medicare & IRMAA Summary to the deck" }));
    expect(props.onAdd).toHaveBeenCalledWith("medicareSummary", expect.anything(), "s1");
  });

  it("previews with the same plan it would add with", async () => {
    const { props } = renderPanel({ deckScenario: "base" });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Plan to base suggestions on"), { target: { value: "s1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Preview Medicare & IRMAA Summary" }));
    expect(props.onPreview).toHaveBeenCalledWith("medicareSummary", expect.anything(), "s1");
  });

  it("fills the added card's slot in place and leaves the others where they were", async () => {
    const { props, rerender } = renderPanel();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    const before = cardTitles();
    rerender(<SuggestedReportsPanel {...props} deckPages={[{ pageId: "medicareSummary", options: {} }]} />);
    const after = cardTitles();
    expect(after).toEqual([before[0], "Monte Carlo", before[2], before[3]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists the essentials the deck is missing under the cards, and adds one with its settings", async () => {
    const { props } = renderPanel({ deckPages: [{ pageId: "balanceSheet", options: {} }] });
    const row = await screen.findByRole("group", { name: "Missing from this deck" });
    // Retirement Summary is already a card, Balance Sheet is in the deck.
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["+ Client Profile"]);
    fireEvent.click(within(row).getByRole("button", { name: "Add Client Profile to the deck" }));
    expect(props.onAdd).toHaveBeenCalledWith("clientProfile", expect.anything(), undefined);
  });

  it("hides the row when nothing essential is missing", async () => {
    renderPanel({
      deckPages: [
        { pageId: "balanceSheet", options: {} },
        { pageId: "clientProfile", options: {} },
      ],
    });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    expect(screen.queryByRole("group", { name: "Missing from this deck" })).toBeNull();
  });

  it("re-reads suggestions when the advisor picks a different plan", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Plan to base suggestions on"), { target: { value: "s1" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/clients/c1/presentations/suggestions?plan=s1", expect.anything()),
    );
  });

  it("offers a retry when the plan can't be read", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
  });
});
