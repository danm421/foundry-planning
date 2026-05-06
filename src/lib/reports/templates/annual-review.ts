// src/lib/reports/templates/annual-review.ts
//
// 4-page seed template: cover → executive summary → net worth & balance
// sheet → cashflow & outlook. All ids are placeholders; the real ids come
// from `cloneTemplateWithFreshIds` when the template is materialised into
// a report.

import type { ReportTemplate } from "./types";

const placeholderId = (): string => "tpl-" + Math.random().toString(36).slice(2, 10);

export const annualReviewTemplate: ReportTemplate = {
  key: "annualReview",
  label: "Annual Review",
  description: "4-page review of net worth, balance sheet, cashflow, and outlook.",
  pages: [
    // Page 1 — Cover
    {
      id: placeholderId(),
      orientation: "portrait",
      rows: [
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "cover",
              props: { title: "Annual Review", year: new Date().getFullYear() },
            },
          ],
        },
      ],
    },
    // Page 2 — Executive summary (sectionHead + 4-up KPIs + AI)
    {
      id: placeholderId(),
      orientation: "portrait",
      rows: [
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "sectionHead",
              props: { eyebrow: "01", title: "Executive summary" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "4-up",
          slots: [
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "netWorthNow", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "liquidNetWorth", showDelta: false },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "monteCarloSuccessProbability", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "annualSavings", showDelta: false },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "aiAnalysis",
              props: {
                title: "Where the household stands",
                scopes: ["balance", "cashflow", "monteCarlo"],
                tone: "concise",
                length: "medium",
                body: "",
              },
            },
          ],
        },
      ],
    },
    // Page 3 — Net worth & balance sheet
    {
      id: placeholderId(),
      orientation: "portrait",
      rows: [
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "sectionHead",
              props: { eyebrow: "02", title: "Net worth & balance sheet" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "netWorthLine",
              props: {
                title: "Net worth over time",
                yearRange: { from: "default", to: "default" },
                ownership: "consolidated",
                compareScenarioId: null,
                showMarkers: false,
                showGrid: true,
              },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "balanceSheetTable",
              props: {
                title: "Balance sheet",
                asOfYear: "current",
                ownership: "consolidated",
                showEntityBreakdown: false,
              },
            },
          ],
        },
      ],
    },
    // Page 4 — Cashflow & outlook
    {
      id: placeholderId(),
      orientation: "portrait",
      rows: [
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "sectionHead",
              props: { eyebrow: "03", title: "Cashflow & outlook" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "cashflowBarChart",
              props: {
                title: "Cashflow",
                yearRange: { from: "default", to: "default" },
                ownership: "consolidated",
                stacking: "stacked",
                showLegend: true,
                showGrid: true,
              },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "monteCarloFan",
              props: {
                title: "Monte Carlo outlook",
                yearRange: { from: "default", to: "default" },
                scenarioId: null,
                bands: [5, 25, 50, 75, 95],
                showHeadline: true,
              },
            },
          ],
        },
      ],
    },
  ],
};
