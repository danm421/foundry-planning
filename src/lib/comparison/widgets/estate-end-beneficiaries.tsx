import { EstateEndBeneficiariesComparisonSection } from "@/components/comparison/estate-end-beneficiaries-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const estateEndBeneficiariesWidget: ComparisonWidgetDefinition = {
  kind: "estate-end-beneficiaries",
  title: "Estate End Beneficiaries",
  category: "estate",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <EstateEndBeneficiariesComparisonSection plans={plans} />,
};
