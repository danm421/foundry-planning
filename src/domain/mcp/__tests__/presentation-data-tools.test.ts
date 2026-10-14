// src/domain/mcp/__tests__/presentation-data-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // Rows the fake db answers with, by table — the ownership checks' two reads.
  rows: { scenarios: [] as { id: string }[], scenario_snapshots: [] as { id: string }[] } as Record<string, unknown[]>,
  buildReportPageData: vi.fn(),
  loadHouseholdBrand: vi.fn(),
  resolveBrandingForClient: vi.fn(),
  resolveIntakeBrandingForClient: vi.fn(),
  getClientWithContacts: vi.fn(),
  verifyClientAccessFor: vi.fn(),
}));

// Drizzle stamps every table with its SQL name under this symbol, so the fake
// answers by WHICH table a query hit.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: Record<symbol, string>) => ({
        where: async () => h.rows[table[Symbol.for("drizzle:Name")]] ?? [],
      }),
    }),
  },
}));
vi.mock("@/components/presentations/page-data", () => ({ buildReportPageData: h.buildReportPageData }));
vi.mock("@/lib/branding/household-brand", () => ({ loadHouseholdBrand: h.loadHouseholdBrand }));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: h.resolveBrandingForClient,
  resolveIntakeBrandingForClient: h.resolveIntakeBrandingForClient,
}));
vi.mock("@/lib/clients/get-client-with-contacts", () => ({ getClientWithContacts: h.getClientWithContacts }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { presentationTools } from "../tools/presentations";
import { MAX_RESPONSE_CHARS } from "../tools/projection-data";
import { scenarioNotFoundMessage } from "../whatif-jobs";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = { userId: "u1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "u1" };
const byName = (n: string) => presentationTools.find((t) => t.name === n)!;
const OWNED = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  h.rows.scenarios = [{ id: OWNED }];
  h.rows.scenario_snapshots = [];
  h.buildReportPageData.mockReset().mockResolvedValue({ rows: [{ year: 2030, total: 1 }] });
  h.loadHouseholdBrand.mockReset().mockResolvedValue("firm");
  h.resolveBrandingForClient.mockReset().mockResolvedValue({
    firmName: "Ethos Wealth",
    primaryColor: "#1f6f5c",
    logoDataUrl: "data:image/png;base64,AAAA",
  });
  h.resolveIntakeBrandingForClient.mockReset().mockResolvedValue({
    logoUrl: "https://blob.example/logo.png",
    firmName: "Ethos Wealth",
    faviconUrl: null,
  });
  h.getClientWithContacts.mockReset().mockResolvedValue({ firstName: "Cooper", lastName: "Sample" });
  h.verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
});

describe("get_report_page_data", () => {
  const pageData = (args: Record<string, unknown>) =>
    byName("get_report_page_data").run({ clientId: "c1", ...args }, principal) as Promise<Record<string, unknown>>;
  const passedBody = () =>
    h.buildReportPageData.mock.calls[0][2] as {
      scenarioId: string | null;
      pages: Array<{ pageId: string; options: Record<string, unknown>; scenarioOverride?: string }>;
    };

  it("returns one page's data with its name, from a one-page body", async () => {
    const out = await pageData({ pageId: "cashFlow" });
    expect(out).toMatchObject({ pageId: "cashFlow", title: "Cash Flow", scenarioId: "base", data: { rows: [{ year: 2030, total: 1 }] } });
    expect(h.buildReportPageData.mock.calls[0].slice(0, 2)).toEqual(["c1", "org_1"]);
    expect(passedBody().pages.map((p) => p.pageId)).toEqual(["cashFlow"]);
    expect(passedBody().scenarioId).toBeNull();
  });

  it("points a comparison page at the scenario it is given", async () => {
    await pageData({ pageId: "retirementComparison", scenarioId: OWNED });
    expect(passedBody().pages[0].options.scenarioId).toBe(OWNED);
  });

  // Review Focus 5: another household's scenario is refused before anything loads.
  it("refuses another household's scenario as the page's own, before loading anything", async () => {
    await expect(pageData({ pageId: "cashFlow", scenarioId: FOREIGN })).rejects.toThrow(scenarioNotFoundMessage(FOREIGN));
    expect(h.buildReportPageData).not.toHaveBeenCalled();
  });

  it("refuses another household's scenario inside a comparison page's options, before loading anything", async () => {
    await expect(pageData({ pageId: "retirementComparison", scenarioId: FOREIGN })).rejects.toThrow(
      scenarioNotFoundMessage(FOREIGN),
    );
    expect(h.buildReportPageData).not.toHaveBeenCalled();
  });

  it("refuses another household's snapshot, before loading anything", async () => {
    await expect(pageData({ pageId: "cashFlow", scenarioId: `snap:${FOREIGN}` })).rejects.toThrow(
      `Snapshot ${FOREIGN} isn't one of this household's snapshots.`,
    );
    expect(h.buildReportPageData).not.toHaveBeenCalled();
  });

  it("refuses a comparison page with nothing to compare, and an unknown page, before loading anything", async () => {
    await expect(pageData({ pageId: "retirementComparison" })).rejects.toThrow(/compares the plan with a scenario/);
    await expect(pageData({ pageId: "nope" })).rejects.toThrow('Unknown page "nope"');
    expect(h.buildReportPageData).not.toHaveBeenCalled();
  });

  it("refuses data too large for one response, naming the narrower call", async () => {
    h.buildReportPageData.mockResolvedValue({ blob: "x".repeat(MAX_RESPONSE_CHARS) });
    await expect(pageData({ pageId: "cashFlow" })).rejects.toThrow(/get_projection_data with fewer sections/);
  });
});

describe("get_branding", () => {
  it("returns the household's brand, a public logo URL and Foundry's disclaimer text — never logo bytes", async () => {
    const out = (await byName("get_branding").run({ clientId: "c1" }, principal)) as {
      brandName: string;
      accentColor: string;
      logoUrl: string | null;
      disclaimers: { short: string; heading: string; long: string[] };
    };
    expect(h.loadHouseholdBrand).toHaveBeenCalledWith("c1", "org_1");
    expect(h.resolveBrandingForClient).toHaveBeenCalledWith("org_1", "firm");
    expect(out).toMatchObject({ brandName: "Ethos Wealth", accentColor: "#1f6f5c", logoUrl: "https://blob.example/logo.png" });
    expect(out.disclaimers.heading).toBe("Important Disclosures");
    expect(out.disclaimers.long[0]).toContain("prepared by Ethos Wealth for Cooper Sample");
    expect(JSON.stringify(out)).not.toContain("data:image");
    expect(JSON.stringify(out)).not.toContain("logoDataUrl");
  });

  it("answers with no logo when the brand has none", async () => {
    h.resolveIntakeBrandingForClient.mockResolvedValue(null);
    const out = (await byName("get_branding").run({ clientId: "c1" }, principal)) as { logoUrl: string | null };
    expect(out.logoUrl).toBeNull();
  });
});
