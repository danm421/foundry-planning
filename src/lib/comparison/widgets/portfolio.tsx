import { PortfolioComparisonSection } from "@/components/comparison/portfolio-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const portfolioWidget: ComparisonWidgetDefinition = {
  kind: "portfolio",
  title: "Portfolio Assets",
  category: "investments",
  scenarios: "one-or-many",
  needsMc: false,
  render: ({ plans }) => <PortfolioComparisonSection plans={plans} />,
};
