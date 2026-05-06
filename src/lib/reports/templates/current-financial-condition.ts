// src/lib/reports/templates/current-financial-condition.ts
//
// 8-page single-plan seed template — the Ethos-style "Current Financial
// Condition" deliverable. Each page is a `sectionHead` + body widgets,
// modelled directly on the spec's per-page layout.
//
// Page tree:
//   1. Cover
//   2. Executive Summary (4-up KPIs + AI)
//   3. Balance Sheet (net worth line + balance sheet table)
//   4. Cash Flows (bar chart + cashflow + expense detail + life phases)
//   5. Tax Planning (tax bracket chart + 2-up KPI strip + advisor commentary)
//   6. Probability of Success (Monte Carlo fan + success KPI)
//   7. Estate Plan (net to heirs KPI + advisor commentary)
//   8. Observations & Disclaimer (action items + disclaimer)
//
// As with the other seed templates, ids here are placeholders;
// `cloneTemplateWithFreshIds` regenerates them when the template is
// materialised into a report.

import type { ReportTemplate } from "./types";

const placeholderId = (): string => "tpl-" + Math.random().toString(36).slice(2, 10);

export const currentFinancialConditionTemplate: ReportTemplate = {
  key: "currentFinancialCondition",
  label: "Current Financial Condition",
  description:
    "8-page single-plan report covering balance sheet, cash flows, tax, probability of success, and estate.",
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
              props: {
                title: "Current Financial Condition",
                year: new Date().getFullYear(),
              },
            },
          ],
        },
      ],
    },
    // Page 2 — Executive Summary
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
              props: { eyebrow: "01", title: "Executive Summary" },
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
              props: {
                metricKey: "monteCarloSuccessProbability",
                showDelta: true,
              },
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
    // Page 3 — Balance Sheet
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
              props: { eyebrow: "02", title: "Balance Sheet" },
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
    // Page 4 — Cash Flows
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
              props: { eyebrow: "03", title: "Cash Flows" },
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
              kind: "cashflowTable",
              props: {
                title: "Cashflow detail",
                yearRange: { from: "default", to: "default" },
                ownership: "consolidated",
                showTotals: true,
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
              kind: "expenseDetailTable",
              props: {
                title: "Expense detail",
                yearRange: { from: "default", to: "default" },
                groupByCategory: true,
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
              kind: "lifePhasesTable",
              props: {
                title: "Life phases",
                rows: [],
              },
            },
          ],
        },
      ],
    },
    // Page 5 — Tax Planning
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
              props: { eyebrow: "04", title: "Tax Planning & Projections" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "taxBracketChart",
              props: {
                title: "Income & tax brackets",
                yearRange: { from: "default", to: "default" },
                showRothBands: true,
              },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "2-up",
          slots: [
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "effectiveTaxRate", showDelta: false },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "currentMarginalTaxRate", showDelta: false },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "advisorCommentary",
              props: {
                headline: "Tax planning notes",
                body: "",
              },
            },
          ],
        },
      ],
    },
    // Page 6 — Probability of Success
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
              props: { eyebrow: "05", title: "Probability of Success" },
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
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: {
                metricKey: "monteCarloSuccessProbability",
                showDelta: false,
              },
            },
          ],
        },
      ],
    },
    // Page 7 — Estate Plan
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
              props: { eyebrow: "06", title: "Estate Planning" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: {
                metricKey: "taxableEstateValue",
                titleOverride: "Net to heirs",
                showDelta: false,
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
              kind: "advisorCommentary",
              props: {
                headline: "Estate planning notes",
                body: "",
              },
            },
          ],
        },
      ],
    },
    // Page 8 — Observations & Disclaimer
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
              props: { eyebrow: "07", title: "Key Observations & Next Steps" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "actionItemsList",
              props: {
                title: "Recommended next steps",
                items: [],
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
              kind: "disclaimerBlock",
              props: { body: "" },
            },
          ],
        },
      ],
    },
  ],
};
