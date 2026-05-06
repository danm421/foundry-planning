// src/lib/reports/widgets/action-items-list.ts
//
// Screen-side registration glue for the actionItemsList widget. A small
// subsection-styled title with an accent underline above a bulleted list
// of action items. Each item carries a colored priority tag
// ([HIGH] / [MED] / [LOW]) and an optional timeframe suffix.
//
// PDF renderer attached separately by `action-items-list.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { ActionItemsListRender } from "@/components/reports/widgets/action-items-list";
import { ActionItemsListInspector } from "@/components/reports/widget-inspectors/action-items-list";

registerWidget({
  kind: "actionItemsList",
  category: "Structure",
  label: "Action Items List",
  description:
    "Priority-tagged bullet list with optional timeframe per item.",
  allowedRowSizes: ["1-up", "2-up"],
  scopes: [],
  defaultProps: {
    title: "Recommended Actions",
    items: [
      {
        priority: "high",
        text: "Submit new workplace retirement deferral elections",
        timeframe: "Within 30 days",
      },
      {
        priority: "high",
        text: "Apply for 15-year term life policies",
        timeframe: "Within 60 days",
      },
      {
        priority: "medium",
        text: "Review and update all beneficiary designations",
        timeframe: "Before year-end",
      },
    ],
  },
  Render: ActionItemsListRender,
  Inspector: ActionItemsListInspector,
});
