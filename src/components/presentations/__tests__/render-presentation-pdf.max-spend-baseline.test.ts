import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ExportPdfBody } from "../render-presentation-pdf";

// The max-spend solve is attached to BUNDLES by the export route, and
// `retirement-comparison/view-model.ts` hides BOTH the max-spend panel and the
// page-1 "Max sustainable spend" KPI when either side's `maxSpend` is null.
// So a solve pointed at the wrong ref is silent and total: the block simply is
// not on the sheet. That is exactly what shipped while this route solved the
// literal "base" and the page had already moved to a chosen baseline —
// measured on a real render, a scenario baseline dropped a panel and a card.
//
// Mocks mirror `render-presentation-pdf.derived-refs.test.ts`.

const dbMocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: dbMocks.select } }));

vi.mock("@/lib/branding/branding", () => ({
  resolveBranding: vi.fn().mockResolvedValue({
    firmName: "Firm Brand",
    primaryColor: "#222222",
    logoDataUrl: null,
  }),
}));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: vi.fn(),
}));
vi.mock("@/lib/presentations/default-logo", () => ({
  foundryDefaultLogoDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,DEFAULT"),
}));

const BASE_TREE = { client: { firstName: "Jane", lastName: "Doe" }, reinvestments: [] };
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTreeForRef: vi.fn(async () => ({ effectiveTree: BASE_TREE })),
  loadEffectiveTree: vi.fn(),
}));

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn(() => ({ years: [], tag: "projection" })),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: vi.fn() }));

// Monte Carlo fires for `retirementComparison` (MONTE_CARLO_PAGE_IDS); stub it
// so this test measures the max-spend wiring alone.
vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: vi.fn(async () => ({ payload: { summary: {} } })),
}));

const maxSpendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/compute-cache/max-spending", () => ({
  getOrComputeMaxSpending: (a: unknown) => maxSpendMock(a),
}));

vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

const BASELINE = "scn-baseline";
const COMPARISON = "scn-comparison";

vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    retirementComparison: {
      id: "retirementComparison",
      supportsScenarioOverride: false,
      optionsSchema: z.object({}).passthrough(),
      // Mirrors the real registration: the baseline first, then the comparison.
      requiredScenarioRefs: (o: { baselineScenarioId: string; scenarioId: string }) =>
        o.scenarioId ? [o.baselineScenarioId, o.scenarioId] : [o.baselineScenarioId],
    },
  },
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { renderPresentationPdf } from "../render-presentation-pdf";

function bodyWithBaseline(baselineScenarioId: string): ExportPdfBody {
  return {
    scenarioId: null,
    filename: undefined,
    preview: false,
    pages: [
      {
        pageId: "retirementComparison",
        options: {
          baselineScenarioId,
          scenarioId: COMPARISON,
          maxSpend: { show: true, targetConfidence: 0.85 },
        },
        scenarioOverride: undefined,
      },
    ],
  } as unknown as ExportPdfBody;
}

describe("renderPresentationPdf — the max-spend solve follows the chosen baseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    dbMocks.select.mockReturnValue({ from: dbMocks.from });
    dbMocks.from.mockReturnValue({ where: dbMocks.where });
    dbMocks.where.mockResolvedValue([]);
    maxSpendMock.mockImplementation(async (a: { scenarioId: string }) => ({
      realAnnualSpend: a.scenarioId === BASELINE ? 111 : 222,
    }));
  });

  it("solves for the BASELINE scenario, never the literal \"base\"", async () => {
    await renderPresentationPdf("client-1", "firm-1", bodyWithBaseline(BASELINE));

    const solvedFor = maxSpendMock.mock.calls.map((c) => (c[0] as { scenarioId: string }).scenarioId);
    expect(solvedFor).toContain(BASELINE);
    expect(solvedFor).toContain(COMPARISON);
    expect(solvedFor).not.toContain("base");
  });

  it("attaches the solve to the bundle the page reads as its left column", async () => {
    await renderPresentationPdf("client-1", "firm-1", bodyWithBaseline(BASELINE));

    const { bundles } = renderToBufferMock.mock.calls[0][0].props;
    // The view-model reads `bundlesByRef[keyForRef(baselineScenarioId)].maxSpend`
    // and hides the panel when it is null — so a solve landing on any other key
    // is indistinguishable from no solve at all.
    expect(bundles[`scenario:${BASELINE}`]?.maxSpend).toEqual({ realAnnualSpend: 111 });
    expect(bundles[`scenario:${COMPARISON}`]?.maxSpend).toEqual({ realAnnualSpend: 222 });
  });

  it("still solves \"base\" when Base Case IS the chosen baseline", async () => {
    await renderPresentationPdf("client-1", "firm-1", bodyWithBaseline("base"));

    const solvedFor = maxSpendMock.mock.calls.map((c) => (c[0] as { scenarioId: string }).scenarioId);
    expect(solvedFor).toContain("base");
    const { bundles } = renderToBufferMock.mock.calls[0][0].props;
    expect(bundles.base?.maxSpend).not.toBeNull();
    expect(bundles.base?.maxSpend).toBeDefined();
  });
});
