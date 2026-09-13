// @vitest-environment jsdom
// src/components/__tests__/estate-transfer-report-view.test.tsx
//
// The engine and the report builder are both mocked: this suite is about
// compare behaviour, not about transfer math (which transfer-report's own
// tests already cover).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

// A REAL `URLSearchParams`, rebuilt on every call — which is what the router
// does in the browser. A stub that hands back the same object forever makes a
// load effect keyed on `searchParams` look stable when it is not, so the
// dependency-array guard below would pass against the unfixed view.
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/engine/projection", () => ({
  runProjection: vi.fn(),
  runProjectionWithEvents: vi.fn(),
}));
vi.mock("@/lib/estate/transfer-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/estate/transfer-report")>()),
  buildEstateTransferReportData: vi.fn(),
}));

import { runProjectionWithEvents } from "@/engine/projection";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import EstateTransferReportView from "@/components/estate-transfer-report-view";
import type {
  DeathSectionData,
  EstateTransferReportData,
  RecipientTotal,
} from "@/lib/estate/transfer-report";

const OWNER_NAMES = { clientName: "Robert", spouseName: "Anita" };
const OWNER_DOBS = { clientDob: "1960-01-01", spouseDob: "1962-01-01" };

function total(key: string, label: string, t: number): RecipientTotal {
  return {
    key,
    recipientLabel: label,
    recipientKind: "family_member",
    fromFirstDeath: 0,
    fromSecondDeath: t,
    total: t,
  } as RecipientTotal;
}

function report(
  totals: RecipientTotal[],
): EstateTransferReportData {
  return {
    ordering: "primaryFirst",
    asOfLabel: "As of today",
    firstDeath: null,
    secondDeath: null,
    aggregateRecipientTotals: totals,
    isEmpty: false,
  } as EstateTransferReportData;
}

/** A reconciling death section whose only moving part is its asset value.
 *  `sumLiabilityTransfers` is an opt-in, because the header's "Estate at death"
 *  nets it and the diff does not — a fixture that leaves it at 0 cannot tell
 *  the chosen chip placement from the rejected one. */
function deathSection(
  assetEstateValue: number,
  opts: { sumLiabilityTransfers?: number; decedentName?: string } = {},
): DeathSectionData {
  const sumLiabilityTransfers = opts.sumLiabilityTransfers ?? 0;
  return {
    decedent: "client",
    decedentName: opts.decedentName ?? "Robert",
    year: 2060,
    taxableEstate: assetEstateValue,
    grossEstate: assetEstateValue,
    assetEstateValue,
    assetCount: 1,
    recipients: [],
    reductions: [],
    conflicts: [],
    grossEstateDollarsByAccount: {},
    grossEstateDollarsByLiability: {},
    reconciliation: {
      sumLiabilityTransfers,
      sumRecipients: assetEstateValue + sumLiabilityTransfers,
      sumReductions: 0,
      unattributed: 0,
      reconciles: true,
    },
  };
}

function viewElement(props: Record<string, unknown> = {}) {
  return (
    <EstateTransferReportView
      clientId="c1"
      isMarried
      ownerNames={OWNER_NAMES}
      ownerDobs={OWNER_DOBS}
      retirementYear={2030}
      {...props}
    />
  );
}

function renderView(props: Record<string, unknown> = {}) {
  return render(viewElement(props));
}

/** Armed fresh per test, so a test can count calls or read the URL fetched. */
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  search = "";
  vi.mocked(runProjectionWithEvents).mockReturnValue({
    years: [{ year: 2026 }],
    firstDeathEvent: { year: 2060 },
    secondDeathEvent: { year: 2061 },
  } as never);
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
});

describe("Transfer Detail compare mode", () => {
  it("suppresses its own control row when the shell supplies asOf", async () => {
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    renderView({ asOf: "today", ordering: "primaryFirst" });
    await screen.findByText("Emma");
    expect(
      screen.queryByRole("group", { name: /death order/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/as of/i)).not.toBeInTheDocument();
  });

  it("keeps its own control row when used standalone", async () => {
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    renderView();
    expect(await screen.findByLabelText(/as of/i)).toBeInTheDocument();
  });

  it("renders no delta chips without a baseline", async () => {
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    renderView({ asOf: "today" });
    await screen.findByText("Emma");
    expect(screen.queryAllByTestId("estate-delta-chip")).toHaveLength(0);
  });

  it("shows a rise to an heir as GOOD news — the opposite of every tax chip", async () => {
    const baseline = report([total("family_member|h1", "Emma", 3_000_000)]);
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 4_200_000)]),
    );
    renderView({ asOf: "today", baseline });
    const chip = await screen.findByTestId("estate-delta-chip");
    expect(chip).toHaveTextContent("$1.2M");
    expect(chip).toHaveTextContent("▴");
    expect(chip).toHaveAttribute("data-tone", "good");
  });

  it("marks a recipient the baseline did not have as added", async () => {
    const baseline = report([]);
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("trust|t1", "Dynasty Trust", 1_900_000)]),
    );
    renderView({ asOf: "today", baseline });
    expect(await screen.findByText("added")).toBeInTheDocument();
  });

  it("keeps a recipient the compared scenario drops, as a $0 row marked removed", async () => {
    const baseline = report([
      total("family_member|h1", "Emma", 3_000_000),
      total("trust|t1", "Dynasty Trust", 1_900_000),
    ]);
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    renderView({ asOf: "today", baseline });
    // Without a ghost row the trust just vanishes from the table, and "who
    // stops inheriting" is the most consequential thing a scenario can change.
    const row = (await screen.findByText("Dynasty Trust")).closest("tr")!;
    expect(within(row).getByText("removed")).toBeInTheDocument();
    const chip = within(row).getByTestId("estate-delta-chip");
    expect(chip).toHaveTextContent("$1.9M");
    expect(chip).toHaveAttribute("data-tone", "bad");
  });

  // The second surface the deltas land on. Same direction as the recipient
  // table — more assets reaching heirs is the good news on this report.
  it("shows a rise in a death section's transfers as good news", async () => {
    const baseline = { ...report([]), firstDeath: deathSection(5_000_000) };
    vi.mocked(buildEstateTransferReportData).mockReturnValue({
      ...report([]),
      firstDeath: deathSection(6_200_000),
    });
    renderView({ asOf: "today", baseline });
    const chip = await screen.findByTestId("estate-delta-chip");
    expect(chip).toHaveTextContent("$1.2M");
    expect(chip).toHaveAttribute("data-tone", "good");
  });

  // Item 4a: with liabilities held at 0 the asset figure and the header figure
  // are numerically identical, so the fixture above cannot distinguish the
  // chosen placement from the rejected one. This one can.
  it("puts the section chip on the asset figure, not the debt-netted header", async () => {
    const baseline = {
      ...report([]),
      firstDeath: deathSection(5_000_000, { sumLiabilityTransfers: -1_000_000 }),
    };
    vi.mocked(buildEstateTransferReportData).mockReturnValue({
      ...report([]),
      firstDeath: deathSection(6_200_000, { sumLiabilityTransfers: -3_000_000 }),
    });
    renderView({ asOf: "today", baseline });
    // The two candidate figures really do diverge in this fixture: assets
    // $6,200,000 (delta +$1.2M, good) vs header $3,200,000 (delta -$800K, bad).
    const reconciled = await screen.findByText(/Reconciled · \$6,200,000/);
    // The header really does carry the other figure, so this fixture can tell
    // the two placements apart.
    expect(screen.getByText("$3,200,000")).toBeInTheDocument();
    // Scoped to the reconciliation line: this pins WHERE the chip sits as well
    // as what it reads. Moving it up to the header fails here even unchanged.
    const chip = within(reconciled).getByTestId("estate-delta-chip");
    expect(chip).toHaveTextContent("$1.2M");
    expect(chip).toHaveAttribute("data-tone", "good");
    expect(screen.getAllByTestId("estate-delta-chip")).toHaveLength(1);
  });

  // A taxable estate is a tax BASE — lower is better for the client, so this
  // is the one chip on this report that points DOWN.
  it("shows a falling taxable estate as good news on the Form 706 line", async () => {
    const baseline = { ...report([]), firstDeath: deathSection(5_000_000) };
    vi.mocked(buildEstateTransferReportData).mockReturnValue({
      ...report([]),
      firstDeath: deathSection(3_800_000),
    });
    renderView({ asOf: "today", baseline });
    expect(
      await screen.findByText("Taxable estate (Form 706)"),
    ).toBeInTheDocument();
    const chip = screen.getByTestId("estate-delta-taxable-estate");
    expect(chip).toHaveTextContent("$1.2M");
    expect(chip).toHaveTextContent("\u25be");
    expect(chip).toHaveAttribute("data-tone", "good");
  });

  // Item 4b: this view is the one place on the branch where BOTH deaths carry
  // deltas (Ruling 11 relaxed), and nothing else exercises the second one.
  it("carries a delta on the second death section too", async () => {
    const baseline = {
      ...report([]),
      secondDeath: deathSection(2_000_000, { decedentName: "Anita" }),
    };
    vi.mocked(buildEstateTransferReportData).mockReturnValue({
      ...report([]),
      secondDeath: deathSection(3_500_000, { decedentName: "Anita" }),
    });
    renderView({ asOf: "today", baseline });
    expect(
      await screen.findByText(/Anita — Second to die/),
    ).toBeInTheDocument();
    const chip = screen.getByTestId("estate-delta-chip");
    expect(chip).toHaveTextContent("$1.5M");
    expect(chip).toHaveAttribute("data-tone", "good");
  });

  it("reports its report data upward on load", async () => {
    const onReady = vi.fn();
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    renderView({ asOf: "today", onReady });
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(
      onReady.mock.calls[0][0].data.aggregateRecipientTotals,
    ).toHaveLength(1);
  });

  it("fetches the scenario ref it was given, not the URL param", async () => {
    search = "scenario=s-left";
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    renderView({ asOf: "today", scenarioRef: "s-right" });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0][0])).toContain("scenario=s-right");
  });

  // The guard for the load effect's dependency array. `?compare=` is written by
  // the shell with `router.push`, which hands every subscriber a FRESH
  // `URLSearchParams` — so an effect keyed on that object refetches BOTH columns
  // against a 30/min/firm rate limit every time the advisor starts or stops a
  // comparison. Keyed on the resolved ref instead, only a scenario change
  // refetches.
  it("does not refetch when an unrelated URL param changes", async () => {
    // No `scenarioRef` prop: the view must resolve the left ref off the URL, so
    // the searchParams object is genuinely in play.
    search = "scenario=s-left";
    vi.mocked(buildEstateTransferReportData).mockReturnValue(
      report([total("family_member|h1", "Emma", 3_000_000)]),
    );
    const { rerender } = renderView({ asOf: "today" });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0][0])).toContain("scenario=s-left");

    // Starting a comparison: same left scenario, new param, new params object.
    search = "scenario=s-left&compare=s-right";
    rerender(viewElement({ asOf: "today" }));
    // Let the re-render settle before counting, so a refetch has every chance
    // to happen rather than the assertion racing it.
    await screen.findByText("Emma");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
