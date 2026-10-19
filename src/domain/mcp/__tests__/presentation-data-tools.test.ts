// src/domain/mcp/__tests__/presentation-data-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // Rows the fake db answers with, by table — the ownership checks' two reads,
  // and the Plan Story chapters the export gate counts.
  rows: {
    scenarios: [] as { id: string }[],
    scenario_snapshots: [] as { id: string }[],
    plan_story_chapters: [] as { chapterId: string; reviewedAt: Date | null }[],
  } as Record<string, unknown[]>,
  recordAudit: vi.fn(),
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
vi.mock("@/lib/audit", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import { planStoryOptionsSchema, printedChapters } from "@/lib/presentations/pages/plan-story/options-schema";
import { presentationTools } from "../tools/presentations";
import { MAX_RESPONSE_CHARS } from "../tools/projection-data";
import { scenarioNotFoundMessage } from "../whatif-jobs";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "u1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "u1",
  canWrite: true,
  entitlements: ["ai_import"],
};
const byName = (n: string) => presentationTools.find((t) => t.name === n)!;
const OWNED = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  h.rows.scenarios = [{ id: OWNED }];
  h.rows.scenario_snapshots = [];
  h.rows.plan_story_chapters = [];
  h.recordAudit.mockReset().mockResolvedValue(undefined);
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

  it("refuses data too large for one response, naming the narrower call in one sentence", async () => {
    h.buildReportPageData.mockResolvedValue({ blob: "x".repeat(MAX_RESPONSE_CHARS) });
    await expect(pageData({ pageId: "cashFlow" })).rejects.toThrow(
      new WhatIfValidationError(
        "That's more data than one call can return. Use get_projection_data with fewer sections or a shorter year range instead.",
      ),
    );
  });

  // The Plan Story's stored chapter text reaches Claude's own deck whether or
  // not an advisor reviewed it, so the soft export gate's warning and audit
  // apply here exactly as they do to a generated deck.
  describe("a Plan Story page", () => {
    const printed = printedChapters(planStoryOptionsSchema.parse(PRESENTATION_PAGES.planStory.defaultOptions));
    const storyAudits = () =>
      h.recordAudit.mock.calls.map((c) => c[0]).filter((a) => a.action === "plan_story.exported_unreviewed");

    it("warns about chapters no advisor has reviewed, and files the export gate's audit as the advisor", async () => {
      h.rows.plan_story_chapters = [{ chapterId: printed[0], reviewedAt: new Date("2026-10-01") }];
      const out = await pageData({ pageId: "planStory" });
      const unreviewed = printed.length - 1;
      expect(out.notes).toEqual([
        `The Plan Story has ${unreviewed} of ${printed.length} chapters no advisor has reviewed yet. Tell the advisor before they share the deck.`,
      ]);
      expect(storyAudits()).toEqual([
        {
          action: "plan_story.exported_unreviewed",
          resourceType: "client",
          resourceId: "c1",
          clientId: "c1",
          firmId: "org_1",
          actorId: "u1",
          metadata: {
            via: "claude",
            tool: "get_report_page_data",
            pageId: "planStory",
            scenarioId: "base",
            documentRole: "standalone",
            unreviewed,
            total: printed.length,
          },
        },
      ]);
    });

    it("says nothing and files no story audit when every chapter is reviewed", async () => {
      h.rows.plan_story_chapters = printed.map((chapterId) => ({ chapterId, reviewedAt: new Date("2026-10-01") }));
      const out = await pageData({ pageId: "planStory" });
      expect(out).not.toHaveProperty("notes");
      expect(storyAudits()).toEqual([]);
    });
  });

  it("adds no story note or audit to any other page", async () => {
    const out = await pageData({ pageId: "cashFlow" });
    expect(out).not.toHaveProperty("notes");
    expect(h.recordAudit.mock.calls.map((c) => c[0].action)).toEqual(["mcp.tool_call"]);
  });

  it("says the Plan Story's chapters come as stored, and only render-time commentary is left out", () => {
    const d = byName("get_report_page_data").description;
    expect(d).not.toContain("AI-written commentary is not included");
    expect(d).toMatch(/Plan Story/);
    expect(d).toMatch(/Investment Proposal/);
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

  // render-presentation-pdf.ts prints the Foundry logo when the brand has none;
  // the description says so and leaves the choice to Claude.
  it("says what Foundry's own decks do without a logo, without dictating a wordmark", () => {
    const d = byName("get_branding").description;
    expect(d).toMatch(/Foundry's own decks print the Foundry logo/);
    expect(d).not.toMatch(/then set the brand name as a wordmark/);
  });
});
