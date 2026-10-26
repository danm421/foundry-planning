import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ExportPdfBody } from "../render-presentation-pdf";

// A single-plan page (Retirement Summary) asks for a max-spending solve on its
// OWN plan — whichever one the row's override picks — through
// `ownPlanMaxSpendTarget`. Pinned here:
//   1. it solves the plan the page prints, override included;
//   2. the result travels with the page ENTRY, never on the shared bundle,
//      whose one `maxSpend` slot a comparison page may fill at another target;
//   3. a snapshot plan is never solved (it would be solved as Base Case);
//   4. a failed solve hands the page null instead of failing the export.
//
// Mocks mirror `render-presentation-pdf.max-spend.test.ts`.

const dbMocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: dbMocks.select } }));

vi.mock("@/lib/branding/branding", () => ({
  resolveBranding: vi.fn().mockResolvedValue({ firmName: "Firm Brand", primaryColor: "#222222", logoDataUrl: null }),
}));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: vi.fn().mockResolvedValue({ firmName: "Firm Brand", primaryColor: "#222222", logoDataUrl: null }),
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

vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

const maxSpendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/compute-cache/max-spending", () => ({
  getOrComputeMaxSpending: maxSpendMock,
}));

// A stand-in single-plan page: its target lives in its options, its plan in
// the row's override.
vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    solo: {
      id: "solo",
      supportsScenarioOverride: true,
      optionsSchema: z.object({ target: z.number().nullable() }),
      ownPlanMaxSpendTarget: (o: { target: number | null }) => o.target,
    },
  },
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { renderPresentationPdf } from "../render-presentation-pdf";

function deck(target: number | null, scenarioOverride?: string): ExportPdfBody {
  return {
    scenarioId: null,
    filename: undefined,
    preview: false,
    pages: [{ pageId: "solo", options: { target }, scenarioOverride }],
  } as unknown as ExportPdfBody;
}

const propsOf = () => renderToBufferMock.mock.calls[0][0].props;

describe("renderPresentationPdf — a single-plan page's own max-spend solve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    dbMocks.select.mockReturnValue({ from: dbMocks.from });
    dbMocks.from.mockReturnValue({ where: dbMocks.where });
    dbMocks.where.mockResolvedValue([]);
    maxSpendMock.mockImplementation(async ({ scenarioId }: { scenarioId: string }) => ({
      realAnnualSpend: scenarioId === "base" ? 145_000 : 170_000,
    }));
  });

  it("solves the deck's plan at the page's target and hands it to that entry only", async () => {
    await renderPresentationPdf("client-1", "firm-1", deck(0.9));

    expect(maxSpendMock).toHaveBeenCalledTimes(1);
    expect(maxSpendMock).toHaveBeenCalledWith({
      clientId: "client-1", firmId: "firm-1", scenarioId: "base", targetPoS: 0.9,
    });
    const props = propsOf();
    expect(props.pages[0].maxSpend).toEqual({ realAnnualSpend: 145_000 });
    expect(props.bundles.base.maxSpend).toBeUndefined();
  });

  it("solves the scenario the row's override picks, not the deck's", async () => {
    await renderPresentationPdf("client-1", "firm-1", deck(0.85, "sc-1"));

    expect(maxSpendMock).toHaveBeenCalledWith({
      clientId: "client-1", firmId: "firm-1", scenarioId: "sc-1", targetPoS: 0.85,
    });
    expect(propsOf().pages[0].maxSpend).toEqual({ realAnnualSpend: 170_000 });
  });

  it("never solves a snapshot plan", async () => {
    await renderPresentationPdf("client-1", "firm-1", deck(0.85, "snap:snap-1"));

    expect(maxSpendMock).not.toHaveBeenCalled();
    expect(propsOf().pages[0].maxSpend).toBeUndefined();
  });

  it("runs no solve when the page asks for none", async () => {
    await renderPresentationPdf("client-1", "firm-1", deck(null));

    expect(maxSpendMock).not.toHaveBeenCalled();
    expect(propsOf().pages[0].maxSpend).toBeUndefined();
  });

  it("hands the page null when the solve fails, and still renders the deck", async () => {
    maxSpendMock.mockRejectedValueOnce(new Error("solver blew up"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderPresentationPdf("client-1", "firm-1", deck(0.85));

    expect(propsOf().pages[0].maxSpend).toBeNull();
    err.mockRestore();
  });
});
