// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecurringDetailPanel } from "@/components/portal/recurring-detail-panel";
import type { RecurringRowDTO } from "@/lib/portal/recurring-matching";

const row: RecurringRowDTO = {
  id: "r1", name: "Movement Mortgage", cadence: "monthly", dueDay: 2, dueMonth: null,
  matchType: "contains", pattern: "Movement", amountMin: 1791, amountMax: 2580,
  categoryId: "c1", categoryName: "Mortgage", categoryColor: "var(--data-orange)", categoryIcon: "🏦",
  predicted: 2151.29, state: "paid", postedThisMonth: 2151.29,
  nextPaymentDate: "2026-07-02",
  timeline: [{ month: "2026-06", paid: true }],
  metricsByYear: [{ year: 2026, total: 12906.45, avg: 2151.08, count: 6 }],
};

it("shows rules, metrics, and the next payment; Edit/Delete only when editable", () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const { rerender } = render(
    <RecurringDetailPanel r={row} editEnabled={false} onClose={() => {}} onEdit={onEdit} onDelete={onDelete} />,
  );
  expect(screen.getByText("Named Movement")).toBeTruthy();
  expect(screen.getByText("Key metrics")).toBeTruthy();
  expect(screen.queryByText("Delete")).toBeNull();

  rerender(
    <RecurringDetailPanel r={row} editEnabled onClose={() => {}} onEdit={onEdit} onDelete={onDelete} />,
  );
  fireEvent.click(screen.getByText("Delete"));
  expect(onDelete).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Edit"));
  expect(onEdit).toHaveBeenCalledOnce();
});
