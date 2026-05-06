// src/lib/reports/widgets/advisor-commentary.ts
//
// Registration glue for the advisorCommentary widget — free-form
// advisor narrative with an optional headline. No engine data, so no
// scopes wired.

import { registerWidget } from "@/lib/reports/widget-registry";
import { AdvisorCommentaryRender } from "@/components/reports/widgets/advisor-commentary";
import { AdvisorCommentaryInspector } from "@/components/reports/widget-inspectors/advisor-commentary";

registerWidget({
  kind: "advisorCommentary",
  category: "Structure",
  label: "Advisor Commentary",
  description: "Optional headline + free-form advisor body. Honors line breaks.",
  allowedRowSizes: ["1-up", "2-up"],
  defaultProps: { body: "" },
  Render: AdvisorCommentaryRender,
  Inspector: AdvisorCommentaryInspector,
});
