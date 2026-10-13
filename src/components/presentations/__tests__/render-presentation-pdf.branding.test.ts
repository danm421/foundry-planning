import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { clients } from "@/db/schema";
import type { ExportPdfBody } from "../render-presentation-pdf";

// Task 11: renderPresentationPdf resolves branding by the CLIENT'S advisor
// (Task 10's resolveBrandingForClient), not the firm alone. This file mocks
// the branding resolver and the advisor lookup (`db.select`) as well as the
// rest of what the function touches, and asserts on what it passes them: which
// advisor id, or "firm", it resolves branding for. A single "cover"-only page
// with scenarioId=null and no spouse keeps every other conditional branch
// (scenario names, investments, life insurance, observations,
// scenario-changes) unreached, so the ONLY `db.select` call in the whole
// function is the advisor-id lookup.

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { select: dbMocks.select } }));

const brandingMocks = vi.hoisted(() => ({
  resolveBrandingForClient: vi.fn(),
}));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: brandingMocks.resolveBrandingForClient,
}));

vi.mock("@/lib/presentations/default-logo", () => ({
  foundryDefaultLogoDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,DEFAULT"),
}));

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTreeForRef: vi.fn(async () => ({
    effectiveTree: {
      client: { firstName: "Jane", lastName: "Doe" },
      reinvestments: [],
    },
  })),
  loadEffectiveTree: vi.fn(),
}));

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn(() => ({ years: [] })),
}));

vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    cover: {
      id: "cover",
      supportsScenarioOverride: false,
      optionsSchema: z.object({}),
    },
  },
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: renderToBufferMock,
}));

import { renderPresentationPdf } from "../render-presentation-pdf";

const CLIENT_ID = "client-1";
const FIRM_ID = "firm-1";

const body = {
  scenarioId: null,
  filename: undefined,
  preview: false,
  pages: [{ pageId: "cover", options: {}, scenarioOverride: undefined }],
} as unknown as ExportPdfBody;

function seedAdvisorLookup(rows: Array<{ advisorId: string; brand: string | null }>) {
  dbMocks.select.mockReturnValue({ from: dbMocks.from });
  dbMocks.from.mockReturnValue({ where: dbMocks.where });
  dbMocks.where.mockResolvedValue(rows);
}

describe("renderPresentationPdf — advisor-aware branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
  });

  it("resolves the client's advisor and uses their brand over the firm's", async () => {
    seedAdvisorLookup([{ advisorId: "adv-77", brand: null }]);
    brandingMocks.resolveBrandingForClient.mockResolvedValue({
      firmName: "Advisor Brand",
      primaryColor: "#111111",
      logoDataUrl: "data:image/png;base64,ADV",
    });

    await renderPresentationPdf(CLIENT_ID, FIRM_ID, body);

    // Positional call — NOT an object literal (would break React `cache()`
    // identity in the sibling web-branding resolver this mirrors).
    expect(brandingMocks.resolveBrandingForClient).toHaveBeenCalledWith("firm-1", "adv-77");

    const doc = renderToBufferMock.mock.calls[0][0];
    expect(doc.props.firmName).toBe("Advisor Brand");
    expect(doc.props.accentColor).toBe("#111111");
    expect(doc.props.firmLogoDataUrl).toBe("data:image/png;base64,ADV");

    // Org-scoping: assert on the actual predicate that reached `.where()`,
    // built from the REAL `and`/`eq` — not just that `eq` was called with
    // each column somewhere, which would still pass even if only one clause
    // made it into the final `.where()` call. This is scoped by BOTH
    // clientId and firmId, never clientId alone.
    expect(dbMocks.select).toHaveBeenCalledWith({ advisorId: clients.advisorId, brand: clients.brand });
    expect(dbMocks.from).toHaveBeenCalledWith(clients);
    expect(dbMocks.where).toHaveBeenCalledWith(
      and(eq(clients.id, CLIENT_ID), eq(clients.firmId, FIRM_ID)),
    );
  });

  it("falls back to firm branding when the client row can't be found", async () => {
    seedAdvisorLookup([]);
    brandingMocks.resolveBrandingForClient.mockResolvedValue({
      firmName: "Firm Brand",
      primaryColor: "#222222",
      logoDataUrl: "data:image/png;base64,FIRM",
    });

    await renderPresentationPdf(CLIENT_ID, FIRM_ID, body);

    expect(brandingMocks.resolveBrandingForClient).toHaveBeenCalledWith(FIRM_ID, "firm");

    const doc = renderToBufferMock.mock.calls[0][0];
    expect(doc.props.firmName).toBe("Firm Brand");
    expect(doc.props.accentColor).toBe("#222222");
    expect(doc.props.firmLogoDataUrl).toBe("data:image/png;base64,FIRM");
  });

  it("uses the household's saved brand", async () => {
    seedAdvisorLookup([{ advisorId: "adv-77", brand: "firm" }]);
    brandingMocks.resolveBrandingForClient.mockResolvedValue({ firmName: "Firm Brand", primaryColor: "#222222", logoDataUrl: null });
    await renderPresentationPdf(CLIENT_ID, FIRM_ID, body);
    expect(brandingMocks.resolveBrandingForClient).toHaveBeenCalledWith("firm-1", "firm");
  });

  it("uses the request's brand without looking the household up", async () => {
    brandingMocks.resolveBrandingForClient.mockResolvedValue({ firmName: "Jane", primaryColor: "#111111", logoDataUrl: null });
    await renderPresentationPdf(CLIENT_ID, FIRM_ID, { ...body, brand: "adv-9" });
    expect(dbMocks.select).not.toHaveBeenCalled();
    expect(brandingMocks.resolveBrandingForClient).toHaveBeenCalledWith("firm-1", "adv-9");
  });
});
