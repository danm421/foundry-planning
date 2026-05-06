// src/lib/reports/templates/retirement-roadmap.ts
//
// 5-page seed template oriented around the retirement narrative:
//   1. Cover
//   2. Section head + KPI strip + AI ("Where you stand")
//   3. Income through retirement + cashflow detail
//   4. Net worth trajectory + allocation pair + advisor commentary
//   5. Monte Carlo outlook + AI risks block
//
// Plan deferred the full structure to the spec — this is a sensible 5-page
// build that respects every widget's `allowedRowSizes`. As with the annual
// review template, ids here are placeholders; `cloneTemplateWithFreshIds`
// regenerates them when the template is materialised into a report.

import type { ReportTemplate } from "./types";

const placeholderId = (): string => "tpl-" + Math.random().toString(36).slice(2, 10);

export const retirementRoadmapTemplate: ReportTemplate = {
  key: "retirementRoadmap",
  label: "Retirement Roadmap",
  description: "5-page roadmap covering income, net worth, allocation, and Monte Carlo outlook.",
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
                title: "Retirement Roadmap",
                subtitle: "Retirement Roadmap",
                year: new Date().getFullYear(),
              },
            },
          ],
        },
      ],
    },
    // Page 2 — Section head + KPI strip + AI ("Where you stand")
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
              props: { eyebrow: "01", title: "Where you stand" },
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
              props: { metricKey: "netWorthAtRetirement", showDelta: false },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "monteCarloSuccessProbability", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "yearsToDepletion", showDelta: false },
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
                title: "Where you stand",
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
    // Page 3 — Income through retirement + cashflow detail
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
              props: { eyebrow: "02", title: "Income through retirement" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "incomeSourcesArea",
              props: {
                title: "Income sources",
                yearRange: { from: "default", to: "default" },
                series: ["wages", "socialSecurity", "withdrawals", "pensions", "other"],
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
      ],
    },
    // Page 4 — Net worth trajectory + 2-up allocation + advisor commentary
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
              props: { eyebrow: "03", title: "Net worth & allocation" },
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
                title: "Net worth trajectory",
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
          layout: "2-up",
          slots: [
            {
              id: placeholderId(),
              kind: "allocationDonut",
              props: {
                title: "Allocation today",
                asOfYear: "current",
                innerRingAssetType: false,
                showLegend: true,
              },
            },
            {
              id: placeholderId(),
              kind: "advisorCommentary",
              props: {
                headline: "Allocation notes",
                body: "",
              },
            },
          ],
        },
      ],
    },
    // Page 5 — Monte Carlo outlook + AI risks
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
              props: { eyebrow: "04", title: "Outlook & risks" },
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
              kind: "aiAnalysis",
              props: {
                title: "Key risks",
                scopes: ["monteCarlo", "cashflow"],
                tone: "concise",
                length: "medium",
                body: "",
              },
            },
          ],
        },
      ],
    },
  ],
};
