// Display strings for the household risk profile, shared by the detail page
// and the PDF export so the two can't describe the same profile differently.
import type { CapacityFactors } from "@/lib/insights/risk-capacity";
import type { BindingConstraint } from "./scoring";

export const TOLERANCE_SOURCE_LABELS: Record<string, string> = {
  rtq_client: "Client RTQ",
  rtq_advisor: "Advisor RTQ",
  manual: "Manual",
};

export function bindingConstraintLine(binding: BindingConstraint): string {
  if (binding === "capacity") return "Capacity is the binding constraint";
  if (binding === "tolerance") return "Tolerance is the binding constraint";
  return "No capacity yet — profile is provisional";
}

/** The environment adjustment always carries its sign: "+5" reads as a
 *  deliberate loosening, "5" reads like a score. */
export function formatAdjustment(adj: number): string {
  return adj > 0 ? `+${adj}` : String(adj);
}

/**
 * Display order and help copy for the five capacity contributions.
 *
 * Help copy states the scoring band for each factor, so an advisor can read a
 * bar and know what would move it. The bands are the curves in
 * `capacityFactors` -- keep the two in step if a curve is ever retuned.
 */
export const CAPACITY_FACTOR_ORDER: {
  key: keyof CapacityFactors;
  label: string;
  help: string;
}[] = [
  {
    key: "runway",
    label: "Years to retirement",
    help: "How long until the portfolio has to start paying out. This is the single biggest factor. Time before the first withdrawal is what turns a bad market into something you buy through rather than sell into. Nothing at 0 years, full marks at 20 or more.",
  },
  {
    key: "incomeFloor",
    label: "Guaranteed income",
    help: "The share of retirement spending covered by Social Security and pensions, averaged over the years those benefits are actually paid. Spending that is already covered never has to be funded by selling. Full marks once it covers all spending — a fully covered household scores high here no matter its age.",
  },
  {
    key: "retirementHorizon",
    label: "Length of retirement",
    help: "Years from retirement to the end of the plan. Even once withdrawals begin, money that will not be spent for another two decades still has time to recover. Nothing at 0 years, full marks at 25 or more.",
  },
  {
    key: "withdrawal",
    label: "Withdrawal rate",
    help: "Average yearly spending not covered by income, measured against the portfolio at retirement. Smaller draws leave more room to absorb a loss. Full marks at 0%, nothing at 6% or more.",
  },
  {
    key: "buffer",
    label: "Funding buffer",
    help: "Compares the lowest point the portfolio reaches with its high point. 1.0 means it just touches zero. Nothing at 0.8, full marks at 1.5 — a low point half the height of the peak.",
  },
];
