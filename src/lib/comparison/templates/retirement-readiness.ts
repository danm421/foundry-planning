import type { ComparisonTemplate } from "./types";

export const retirementReadinessTemplate: ComparisonTemplate = {
  key: "retirement-readiness",
  name: "Retirement Readiness",
  description: "Side-by-side Monte Carlo, cash-flow gap, and lifetime tax across two plans.",
  slotCount: 2,
  slotLabels: ["Current Plan", "Proposed Plan"],
  layout: {
    version: 5,
    title: "Retirement Readiness",
    groups: [
      {
        id: "rr-g1",
        title: "",
        cells: [
          {
            id: "rr-c1",
            span: 4,
            widget: {
              id: "rr-w1",
              kind: "monte-carlo",
              planIds: ["A", "B"],
              config: { viewMode: "chart+table" },
            },
          },
          {
            id: "rr-c2",
            span: 4,
            widget: {
              id: "rr-w2",
              kind: "cash-flow-gap",
              planIds: ["A", "B"],
              config: { viewMode: "chart+table" },
            },
          },
          {
            id: "rr-c3",
            span: 4,
            widget: {
              id: "rr-w3",
              kind: "lifetime-tax",
              planIds: ["A", "B"],
              config: { viewMode: "chart" },
            },
          },
        ],
      },
    ],
  },
};
