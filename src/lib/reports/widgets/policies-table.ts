// src/lib/reports/widgets/policies-table.ts
//
// Screen-side registration glue for the policiesTable widget. Branded
// table for insurance policies (Type / Owner / Death Benefit / Annual
// Premium). When `rows` is empty the widget renders an emptyStateMessage
// callout card painted with the `report-crit` palette — the absence of
// policies is itself a planning signal worth surfacing.
//
// Pure prop-driven widget — no engine data, no scopes wired.
//
// PDF renderer attached separately by `policies-table.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { PoliciesTableRender } from "@/components/reports/widgets/policies-table";
import { PoliciesTableInspector } from "@/components/reports/widget-inspectors/policies-table";

registerWidget({
  kind: "policiesTable",
  category: "Data Table",
  label: "Policies Table",
  description:
    "Branded table for insurance policies. Renders an empty-state callout (crit-tinted card) when no rows are present.",
  allowedRowSizes: ["1-up"],
  defaultProps: {
    title: "Recommended Policies",
    rows: [],
    emptyStateMessage: "No life insurance policies in place",
  },
  Render: PoliciesTableRender,
  Inspector: PoliciesTableInspector,
});
