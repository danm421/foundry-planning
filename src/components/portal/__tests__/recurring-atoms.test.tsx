// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CategoryBadge } from "@/components/portal/category-badge";
import { RecurringProgressRing } from "@/components/portal/recurring-progress-ring";
import { RecurringTimeline } from "@/components/portal/recurring-timeline";

it("CategoryBadge renders name + icon, null when nameless", () => {
  const { container, getByText } = render(
    <CategoryBadge name="Home" color="var(--data-orange)" icon="🏠" />,
  );
  expect(getByText("Home")).toBeTruthy();
  expect(getByText("🏠")).toBeTruthy();
  const { container: empty } = render(<CategoryBadge name={null} color={null} icon={null} />);
  expect(empty.firstChild).toBeNull();
});

it("RecurringProgressRing draws a partial arc proportional to paid share", () => {
  const { container } = render(<RecurringProgressRing leftToPay={1565} paidSoFar={2648} />);
  expect(container.querySelectorAll("circle").length).toBe(2);
});

it("RecurringTimeline renders one marker per month plus the upcoming marker", () => {
  const { container } = render(
    <RecurringTimeline
      timeline={[{ month: "2026-05", paid: false }, { month: "2026-06", paid: true }]}
      upcoming="2026-07-02"
    />,
  );
  // 2 month dots + 1 upcoming dot
  expect(container.querySelectorAll("[data-dot]").length).toBe(3);
});
