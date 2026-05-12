import type { ComparisonTemplate } from "./types";

export const rothConversionAnalysisTemplate: ComparisonTemplate = {
  key: "roth-conversion-analysis",
  name: "Roth Conversion Analysis",
  description: "Compare three Roth conversion strategies across lifetime tax, RMD schedule, Monte Carlo, and cash flow.",
  slotCount: 3,
  slotLabels: ["No Conversion", "Partial Conversion", "Full Conversion"],
  layout: {
    version: 5,
    title: "Roth Conversion Analysis",
    groups: [
      {
        id: "rc-g1",
        title: "",
        cells: [
          {
            id: "rc-c1",
            span: 4,
            widget: {
              id: "rc-w1",
              kind: "lifetime-tax",
              planIds: ["A", "B", "C"],
              config: { viewMode: "chart+table" },
            },
          },
          {
            id: "rc-c2",
            span: 4,
            widget: {
              id: "rc-w2",
              kind: "rmd-schedule",
              planIds: ["A", "B", "C"],
              config: { viewMode: "table" },
            },
          },
          {
            id: "rc-c3",
            span: 4,
            widget: {
              id: "rc-w3",
              kind: "monte-carlo",
              planIds: ["A", "B", "C"],
              config: { viewMode: "chart" },
            },
          },
          {
            id: "rc-c4",
            span: 4,
            widget: {
              id: "rc-w4",
              kind: "cash-flow-gap",
              planIds: ["A", "B", "C"],
              config: { viewMode: "chart" },
            },
          },
        ],
      },
    ],
  },
};
