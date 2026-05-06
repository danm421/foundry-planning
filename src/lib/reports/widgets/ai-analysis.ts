// src/lib/reports/widgets/ai-analysis.ts
//
// Registration glue for the aiAnalysis widget. `scopes: []` is intentional
// — the actual scope set is dynamic and lives on `props.scopes`, which
// `collectScopesFromTree` reads via the special-case branch in
// `data-loader.ts`. The empty static list keeps the registry contract
// uniform without double-counting scopes.

import { registerWidget } from "@/lib/reports/widget-registry";
import { AiAnalysisRender } from "@/components/reports/widgets/ai-analysis";
import { AiAnalysisInspector } from "@/components/reports/widget-inspectors/ai-analysis";

registerWidget({
  kind: "aiAnalysis",
  category: "AI",
  label: "AI Analysis",
  description: "Generated commentary scoped to selected data.",
  allowedRowSizes: ["1-up", "2-up"],
  scopes: [],
  defaultProps: {
    scopes: ["cashflow", "balance"],
    tone: "concise",
    length: "medium",
    body: "",
  },
  Render: AiAnalysisRender,
  Inspector: AiAnalysisInspector,
});
