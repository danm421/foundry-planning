import { ClientProfileComparisonSection } from "@/components/comparison/client-profile-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const clientProfileWidget: ComparisonWidgetDefinition = {
  kind: "client-profile",
  title: "Client Profile",
  category: "cashflow",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <ClientProfileComparisonSection plans={plans} />,
};
