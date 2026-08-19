import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { entryDerivedKey } from "@/lib/presentations/derived-refs";
import type { ExportPdfBody } from "../render-presentation-pdf";

// The export ROUTE is what turns a page's `requiredDerivedRefs` into built
// bundles. `resolveDerivedBundles` is unit-tested next door, but nothing proved
// the route still CALLS it — delete the call and the whole suite stayed green
// while every ladder sheet silently printed its empty state.
//
// Mocks mirror `render-presentation-pdf.branding.test.ts`: everything the
// function touches except the derived-ref wiring under test.

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

const engineMocks = vi.hoisted(() => ({
  runProjection: vi.fn(() => ({ years: [], tag: "projection" })),
  applyMutations: vi.fn(() => ({ tag: "mutated-tree" })),
}));
vi.mock("@/engine/projection", () => ({ runProjectionWithEvents: engineMocks.runProjection }));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: engineMocks.applyMutations }));

vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

const LADDER_MUTATIONS = [{ kind: "savings-annual-percent", accountId: "a1", percent: 0.11 }];
vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    earlyYearsLadder: {
      id: "earlyYearsLadder",
      supportsScenarioOverride: false,
      optionsSchema: z.object({}),
      requiredScenarioRefs: () => ["base"],
      requiredDerivedRefs: () => [
        { key: "rung1", from: "base", label: "+3pp", mutations: () => LADDER_MUTATIONS },
      ],
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
  pages: [{ pageId: "earlyYearsLadder", options: {}, scenarioOverride: undefined }],
} as unknown as ExportPdfBody;

describe("renderPresentationPdf — derived plan variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    dbMocks.select.mockReturnValue({ from: dbMocks.from });
    dbMocks.from.mockReturnValue({ where: dbMocks.where });
    dbMocks.where.mockResolvedValue([]);
    engineMocks.runProjection.mockReturnValue({ years: [], tag: "projection" });
    engineMocks.applyMutations.mockReturnValue({ tag: "mutated-tree" });
  });

  it("builds the variant the page asked for and hands it to the document", async () => {
    await renderPresentationPdf("client-1", "firm-1", body);

    const { bundles } = renderToBufferMock.mock.calls[0][0].props;
    expect(bundles[entryDerivedKey(0, "earlyYearsLadder", "rung1")]).toEqual({
      clientData: { tag: "mutated-tree" },
      projection: { years: [], tag: "projection" },
      scenarioLabel: "+3pp",
    });
    // …alongside the loaded base bundle, not instead of it.
    expect(bundles.base.clientData).toBe(BASE_TREE);
  });

  it("applies the page's own mutations to the ref it derives FROM", async () => {
    await renderPresentationPdf("client-1", "firm-1", body);
    expect(engineMocks.applyMutations).toHaveBeenCalledWith(BASE_TREE, LADDER_MUTATIONS);
  });
});
