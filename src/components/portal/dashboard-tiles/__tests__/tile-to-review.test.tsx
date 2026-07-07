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
      <TileToReview items={items} count={2} error={false} onMarkReviewed={onMark} onOpen={() => {}} />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    expect(onMark).toHaveBeenCalledWith("t1");
  });

  it("reports row opens and surfaces the error line", () => {
    const onOpen = vi.fn();
    render(
      <TileToReview items={items} count={2} error onMarkReviewed={() => {}} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByText("Amazon"));
    expect(onOpen).toHaveBeenCalledWith("t1");
    expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument();
  });

  it("shows the caught-up state at zero", () => {
    render(
      <TileToReview items={[]} count={0} error={false} onMarkReviewed={() => {}} onOpen={() => {}} />,
    );
    expect(screen.getByText(/caught up/)).toBeInTheDocument();
  });
});
