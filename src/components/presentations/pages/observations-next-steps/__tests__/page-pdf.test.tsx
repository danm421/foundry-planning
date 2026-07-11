import { describe, it, expect } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { ObservationsNextStepsPagePdf } from "../page-pdf";
import {
  buildObservationsPageData,
  type ObservationsRowInput,
} from "@/lib/presentations/pages/observations-next-steps/view-model";
import { OBSERVATIONS_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/pages/observations-next-steps/options-schema";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type { TokenContext } from "@/lib/plan-text/tokens";

// Fixture ctx mirrors src/lib/presentations/pages/observations-next-steps/__tests__/view-model.test.ts
// (net_worth resolves to $2,100,000 = 2,500,000 portfolio assets - 400,000 liabilities).
const clientData = {
  client: {
    firstName: "Sam",
    lastName: "Client",
    dateOfBirth: "1971-01-01",
    retirementAge: 65,
    planEndAge: 95,
    spouseName: "Alex",
    filingStatus: "married_joint",
  },
} as unknown as ClientData;

const firstYear = {
  year: 2026,
  ages: { client: 55 },
  totalIncome: 150000,
  expenses: { total: 120000 },
  savings: { total: 30000 },
  portfolioAssets: { total: 2500000, liquidTotal: 1800000 },
  liabilityBalancesBoY: { l1: 400000 },
  hypotheticalEstateTax: {
    year: 2026,
    primaryFirst: { totals: { total: 0 } },
  },
};

const projection = { years: [firstYear] } as unknown as ProjectionResult;
const ctx: TokenContext = { clientData, projection };

// One observation (estate topic), one in-progress high-priority next step
// (owner + target date), one done next step (muted, no owner/date).
const rows: ObservationsRowInput[] = [
  {
    section: "observation",
    topic: "estate",
    title: null,
    body: "Net worth today is {{net_worth}}.",
    status: "open",
    owner: null,
    priority: null,
    targetDate: null,
    sortOrder: 0,
  },
  {
    section: "next_step",
    topic: "general",
    title: "Rebalance portfolio",
    body: "Review asset allocation against targets.",
    status: "in_progress",
    owner: "advisor",
    priority: "high",
    targetDate: "2026-08-01",
    sortOrder: 1,
  },
  {
    section: "next_step",
    topic: "general",
    title: "Sign updated estate documents",
    body: "Finalize with the estate attorney.",
    status: "done",
    owner: "client",
    priority: null,
    targetDate: null,
    sortOrder: 2,
  },
];

const frame = {
  firmName: "Foundry Planning",
  clientName: "Sam Client",
  reportDate: "July 11, 2026",
  pageIndex: 0,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
};

describe("ObservationsNextStepsPagePdf", () => {
  it("renders a topic heading, a next-step title, owner/date meta, and a priority dot without throwing", async () => {
    ensureFontsRegistered();
    const data = buildObservationsPageData({ rows, ctx, options: OBSERVATIONS_PAGE_OPTIONS_DEFAULT });
    // Sanity-check the view-model output actually carries what this render
    // exercises (the topic heading and next-step title the PDF must draw).
    expect(data.topicGroups.map((g) => g.topic)).toContain("estate");
    expect(data.nextSteps.some((s) => s.title === "Rebalance portfolio")).toBe(true);
    expect(data.showOwnerAndDate).toBe(true);

    const buf = await renderToBuffer(
      <Document>
        <ObservationsNextStepsPagePdf data={data} {...frame} />
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("hides owner/date meta when showOwnerAndDate is false, without throwing", async () => {
    ensureFontsRegistered();
    const data = buildObservationsPageData({
      rows,
      ctx,
      options: { ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, showOwnerAndDate: false },
    });
    expect(data.showOwnerAndDate).toBe(false);
    // ownerLabel/dateLabel are still present on the row — the page component
    // is responsible for not rendering them when showOwnerAndDate is false.
    expect(data.nextSteps[0].ownerLabel).toBe("Advisor");

    const buf = await renderToBuffer(
      <Document>
        <ObservationsNextStepsPagePdf data={data} {...frame} />
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders the empty state (no intro, no observations, no next steps) without throwing", async () => {
    ensureFontsRegistered();
    const data = buildObservationsPageData({ rows: [], ctx, options: OBSERVATIONS_PAGE_OPTIONS_DEFAULT });
    expect(data.topicGroups).toEqual([]);
    expect(data.nextSteps).toEqual([]);

    const buf = await renderToBuffer(
      <Document>
        <ObservationsNextStepsPagePdf data={data} {...frame} />
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(0);
  });
});
