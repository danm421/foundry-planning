import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ExportPdfBody } from "../render-presentation-pdf";

// The export route turns a page's `maxSpendRefs` hook into max-spending solves
// and attaches each result to that ref's bundle. Two things need pinning:
//   1. it still CALLS the hook (it used to test `pageId === "retirementComparison"`);
//   2. it SKIPS a snapshot ref — a snapshot has no solvable scenario id, so
//      solving it would attach Base Case's number to the snapshot's bundle and
//      print a wrong figure under a snapshot's name.
//
// Mocks mirror `render-presentation-pdf.derived-refs.test.ts`: everything the
// function touches except the max-spend wiring under test.

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

vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

const maxSpendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/compute-cache/max-spending", () => ({
  getOrComputeMaxSpending: maxSpendMock,
}));

// A stand-in page whose hook names all three ref shapes at once: base, a live
// scenario, and a snapshot.
vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    spendy: {
      id: "spendy",
      supportsScenarioOverride: false,
      optionsSchema: z.object({}),
      requiredScenarioRefs: () => ["base", "sc-1", "snap:snap-1"],
      maxSpendRefs: () => ({ refs: ["base", "sc-1", "snap:snap-1"], targetPoS: 0.85 }),
    },
  },
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { renderPresentationPdf } from "../render-presentation-pdf";

const body = {
  scenarioId: null,
  filename: undefined,
  preview: false,
  pages: [{ pageId: "spendy", options: {}, scenarioOverride: undefined }],
} as unknown as ExportPdfBody;

describe("renderPresentationPdf — max-spend solves from the registry hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    dbMocks.select.mockReturnValue({ from: dbMocks.from });
    dbMocks.from.mockReturnValue({ where: dbMocks.where });
    dbMocks.where.mockResolvedValue([]);
    maxSpendMock.mockImplementation(async ({ scenarioId }: { scenarioId: string }) => ({
      realAnnualSpend: scenarioId === "base" ? 164_000 : 182_000,
    }));
  });

  it("solves base and the live scenario, and attaches each to its own bundle", async () => {
    await renderPresentationPdf("client-1", "firm-1", body);

    expect(maxSpendMock).toHaveBeenCalledWith({
      clientId: "client-1", firmId: "firm-1", scenarioId: "base", targetPoS: 0.85,
    });
    expect(maxSpendMock).toHaveBeenCalledWith({
      clientId: "client-1", firmId: "firm-1", scenarioId: "sc-1", targetPoS: 0.85,
    });

    const { bundles } = renderToBufferMock.mock.calls[0][0].props;
    expect(bundles.base.maxSpend).toEqual({ realAnnualSpend: 164_000 });
    expect(bundles["scenario:sc-1"].maxSpend).toEqual({ realAnnualSpend: 182_000 });
  });

  it("never solves a snapshot ref, and leaves its bundle's maxSpend unset", async () => {
    await renderPresentationPdf("client-1", "firm-1", body);

    // Base Case's number must not be solved a second time and pinned onto the
    // snapshot: that prints a wrong figure under the snapshot's name.
    const solved = maxSpendMock.mock.calls
      .map((c: unknown[]) => (c[0] as { scenarioId: string }).scenarioId)
      .sort();
    expect(solved).toEqual(["base", "sc-1"]);

    const { bundles } = renderToBufferMock.mock.calls[0][0].props;
    // The snapshot bundle is still LOADED and rendered — it just carries no solve.
    expect(bundles["snap:snap-1"]).toBeDefined();
    expect(bundles["snap:snap-1"].maxSpend).toBeUndefined();
  });
});
