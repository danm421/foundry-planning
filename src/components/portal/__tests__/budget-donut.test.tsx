// src/components/portal/__tests__/budget-donut.test.tsx
// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-chartjs-2", () => ({
  Doughnut: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="donut">{data.labels.join(",")}</div>
  ),
}));
vi.mock("chart.js", () => ({
  Chart: { register: () => {} },
  ArcElement: {}, Tooltip: {}, Legend: {},
}));
vi.mock("@/lib/chart-colors", () => ({
  useThemeName: () => "dark",
  chartChrome: () => ({ tooltipBg: "#111", tooltipTitle: "#fff", tooltipBody: "#ccc" }),
  dataPalette: () => ({ orange: "#e08a2b", purple: "#7d5fb2", grey: "#888" }),
}));

import { BudgetDonut } from "@/components/portal/budget-donut";

const groups = [
  { id: "g-food", name: "Food", color: "var(--data-orange)", budget: null, budgetIsExplicit: false, actual: 230, remaining: null, leaves: [] },
  { id: "g-shop", name: "Shopping", color: "var(--data-purple)", budget: null, budgetIsExplicit: false, actual: 0, remaining: null, leaves: [] },
];

it("renders only groups with spend and shows total in the center", () => {
  render(<BudgetDonut groups={groups} totalSpent={230} />);
  expect(screen.getByTestId("donut").textContent).toBe("Food"); // shopping (0) excluded
  expect(screen.getByText("$230")).toBeTruthy();
});

it("returns null when nothing was spent", () => {
  const { container } = render(
    <BudgetDonut groups={groups.map((g) => ({ ...g, actual: 0 }))} totalSpent={0} />,
  );
  expect(container.firstChild).toBeNull();
});
