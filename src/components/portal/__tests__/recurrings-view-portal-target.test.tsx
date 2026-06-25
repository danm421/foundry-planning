// @vitest-environment jsdom
//
// Regression guard (mirrors budget-view-portal-target): the detail rail must
// mount into a SIBLING #portal-detail resolved AFTER commit, never during render.
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/portal/portal-mode-context", () => ({ usePortalFetch: () => vi.fn() }));

import RecurringsView from "@/components/portal/recurrings-view";
import type { RecurringsData } from "@/lib/portal/recurring-matching";

const data: RecurringsData = {
  month: "2026-06",
  paidSoFar: 100,
  leftToPay: 50,
  recurrings: [
    {
      id: "r1", name: "Netflix", cadence: "monthly", dueDay: 8, dueMonth: null,
      matchType: "contains", pattern: "netflix", amountMin: 10, amountMax: 20,
      categoryId: "c1", categoryName: "Subscriptions", categoryColor: "var(--data-purple)", categoryIcon: "📺",
      predicted: 15, state: "paid", postedThisMonth: 15,
      nextPaymentDate: "2026-07-08",
      timeline: [{ month: "2026-06", paid: true }],
      metricsByYear: [{ year: 2026, total: 90, avg: 15, count: 6 }],
    },
  ],
};

function LayoutLike(): ReactElement {
  return (
    <div>
      <main>
        <RecurringsView data={data} categories={[]} editEnabled={false} />
      </main>
      <aside id="portal-detail" />
    </div>
  );
}

it("portals the recurring detail into #portal-detail when a row is selected", () => {
  render(<LayoutLike />);
  expect(screen.queryByText("Key metrics")).toBeNull();
  fireEvent.click(screen.getByText("Netflix"));
  expect(screen.getByText("Key metrics")).toBeTruthy();
});
