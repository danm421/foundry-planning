// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TileToReview } from "@/components/portal/dashboard-tiles/tile-to-review";
import type { ReviewTxn } from "@/lib/portal/load-dashboard";

// Queue state (and the reviewed PUT) lives in DashboardGrid — this tile is
// presentational. The PUT round-trip is covered by dashboard-grid.test.tsx.
const items: ReviewTxn[] = [
  { id: "t1", date: "2026-06-20", name: "AMZN", merchantName: "Amazon", amount: 42, accountName: "Card", categoryId: null, categoryName: null, categoryColor: null },
  { id: "t2", date: "2026-06-19", name: "SBUX", merchantName: "Starbucks", amount: 6, accountName: "Card", categoryId: null, categoryName: null, categoryColor: null },
];

describe("TileToReview", () => {
  it("renders the count and reports checkmark clicks", () => {
    const onMark = vi.fn();
    render(
      <TileToReview items={items} count={2} error={false} editEnabled onMarkReviewed={onMark} onMarkAll={() => {}} onOpen={() => {}} />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    expect(onMark).toHaveBeenCalledWith("t1");
  });

  it("reports mark-all clicks", () => {
    const onMarkAll = vi.fn();
    render(
      <TileToReview items={items} count={2} error={false} editEnabled onMarkReviewed={() => {}} onMarkAll={onMarkAll} onOpen={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mark all reviewed/i }));
    expect(onMarkAll).toHaveBeenCalledTimes(1);
  });

  it("hides edit controls when editing is disabled", () => {
    render(
      <TileToReview items={items} count={2} error={false} editEnabled={false} onMarkReviewed={() => {}} onMarkAll={() => {}} onOpen={() => {}} />,
    );
    expect(screen.queryByLabelText("Mark as reviewed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark all reviewed/i })).not.toBeInTheDocument();
    // The rows themselves are still visible and openable.
    expect(screen.getByText("Amazon")).toBeInTheDocument();
  });

  it("reports row opens and surfaces the error line", () => {
    const onOpen = vi.fn();
    render(
      <TileToReview items={items} count={2} error editEnabled onMarkReviewed={() => {}} onMarkAll={() => {}} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByText("Amazon"));
    expect(onOpen).toHaveBeenCalledWith("t1");
    expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument();
  });

  it("shows the caught-up state at zero", () => {
    render(
      <TileToReview items={[]} count={0} error={false} editEnabled onMarkReviewed={() => {}} onMarkAll={() => {}} onOpen={() => {}} />,
    );
    expect(screen.getByText(/caught up/)).toBeInTheDocument();
  });
});
