// src/lib/reports/templates/current-vs-proposed.ts
//
// 8-page Plan Comparison seed template — the Ethos-style "Current vs.
// Proposed" deliverable. Requires a `comparisonBinding` at report
// creation; comparison-aware widgets (`recommendedChangesTable`,
// `keyIndicatorsCallout`, `portfolioComparisonLine`,
// `monteCarloComparisonBars`, `comparisonDonutPair`) read from the
// shared comparison scope.
//
// Page tree:
//   1. Cover
//   2. Executive Summary (AI intro + 4-up KPIs + recommended changes list)
//   3. Where You Are Today (AI intro + indicators + 4-up KPIs + allocation)
//   4. What's at Risk (AI intro + risk table + severity bar)
//   5. What Improves with the Plan (AI intro + 2-up [portfolio line, MC
//      bars] + 4-up KPIs + comparison donut pair)
//   6. Summary of Proposed Changes (full 3-column recommended changes)
//   7. Tax Strategy Optimization (2-up effective rate KPIs + lifetime
//      tax savings status callout)
//   8. Insurance & Estate + Action Items (policies + insurance status +
//      net to heirs KPI + action items + disclaimer)
//
// As with the other seed templates, ids here are placeholders;
// `cloneTemplateWithFreshIds` regenerates them when the template is
// materialised into a report.

import type { ReportTemplate } from "./types";

const placeholderId = (): string => "tpl-" + Math.random().toString(36).slice(2, 10);

export const currentVsProposedTemplate: ReportTemplate = {
  key: "currentVsProposed",
  label: "Plan Comparison",
  description:
    "8-page Current vs. Proposed comparison report; requires two bound scenarios.",
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
                title: "Plan Comparison",
                subtitle: "Current vs. Proposed",
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
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "aiAnalysis",
              props: {
                title: "Plan comparison summary",
                scopes: ["balance", "cashflow", "monteCarlo"],
                tone: "concise",
                length: "medium",
                body: "",
              },
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
              props: {
                metricKey: "monteCarloSuccessProbability",
                showDelta: true,
              },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "netWorthNow", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "effectiveTaxRate", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "taxableEstateValue", showDelta: true },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "recommendedChangesTable",
              props: {
                title: "Recommended changes",
                variant: "list",
                rows: [],
              },
            },
          ],
        },
      ],
    },
    // Page 3 — Where You Are Today
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
              props: { eyebrow: "02", title: "Where You Are Today" },
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
                title: "Current state",
                scopes: ["balance", "cashflow"],
                tone: "concise",
                length: "medium",
                body: "",
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
              kind: "keyIndicatorsCallout",
              props: {
                title: "Key indicators",
                bullets: [],
              },
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
              props: { metricKey: "netWorthNow", showDelta: false },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "liquidNetWorth", showDelta: false },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "annualSavings", showDelta: false },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "annualSpending", showDelta: false },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "allocationDonut",
              props: {
                title: "Current allocation",
                asOfYear: "current",
                innerRingAssetType: false,
                showLegend: true,
              },
            },
          ],
        },
      ],
    },
    // Page 4 — What's at Risk
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
              props: { eyebrow: "03", title: "What's at Risk" },
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
                title: "Risk overview",
                scopes: ["monteCarlo", "cashflow"],
                tone: "concise",
                length: "medium",
                body: "",
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
              kind: "riskTable",
              props: {
                title: "Identified risks",
                rows: [],
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
              kind: "riskSeverityBar",
              props: {
                title: "Risk severity",
                rows: [],
              },
            },
          ],
        },
      ],
    },
    // Page 5 — What Improves with the Plan
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
              props: { eyebrow: "04", title: "What Improves with the Plan" },
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
                title: "What improves",
                scopes: ["balance", "monteCarlo"],
                tone: "concise",
                length: "medium",
                body: "",
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
              kind: "portfolioComparisonLine",
              props: {
                title: "Portfolio comparison",
                yearRange: { from: "default", to: "default" },
                showGrid: true,
              },
            },
            {
              id: placeholderId(),
              kind: "monteCarloComparisonBars",
              props: { title: "Monte Carlo comparison" },
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
              props: {
                metricKey: "monteCarloSuccessProbability",
                showDelta: true,
              },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "netWorthNow", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "annualSavings", showDelta: true },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: { metricKey: "taxableEstateValue", showDelta: true },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "comparisonDonutPair",
              props: {
                title: "Allocation comparison",
                asOfYear: "current",
                showLegend: true,
              },
            },
          ],
        },
      ],
    },
    // Page 6 — Summary of Proposed Changes
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
              props: { eyebrow: "05", title: "Summary of Proposed Changes" },
            },
          ],
        },
        {
          id: placeholderId(),
          layout: "1-up",
          slots: [
            {
              id: placeholderId(),
              kind: "recommendedChangesTable",
              props: {
                title: "Current vs. proposed",
                variant: "currentVsProposed",
                rows: [],
              },
            },
          ],
        },
      ],
    },
    // Page 7 — Tax Strategy Optimization
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
              props: { eyebrow: "06", title: "Tax Strategy Optimization" },
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
              props: {
                metricKey: "effectiveTaxRate",
                titleOverride: "Effective tax rate — current",
                showDelta: false,
              },
            },
            {
              id: placeholderId(),
              kind: "kpiTile",
              props: {
                metricKey: "effectiveTaxRate",
                titleOverride: "Effective tax rate — proposed",
                showDelta: true,
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
              kind: "statusCallout",
              props: {
                status: "go",
                headline: "Lifetime tax savings",
                body: "",
              },
            },
          ],
        },
      ],
    },
    // Page 8 — Insurance & Estate + Action Items
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
              props: {
                eyebrow: "07",
                title: "Insurance, Estate & Action Items",
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
              kind: "policiesTable",
              props: {
                title: "Insurance policies",
                rows: [],
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
              kind: "statusCallout",
              props: {
                status: "warn",
                headline: "Insurance gap",
                body: "",
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
                metricKey: "taxableEstateValue",
                titleOverride: "Net to heirs (proposed)",
                showDelta: true,
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
              kind: "actionItemsList",
              props: {
                title: "Action items",
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
