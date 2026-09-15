// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TileToReview } from "@/components/portal/dashboard-tiles/tile-to-review";
import type { CategoryRow } from "@/components/portal/category-combobox";
import type { ReviewTxn } from "@/lib/portal/load-dashboard";

// Queue state (and the reviewed/category PUTs) lives in DashboardGrid — this
// tile is presentational. The PUT round-trips are covered by dashboard-grid.test.tsx.
const items: ReviewTxn[] = [
  { id: "t1", date: "2026-06-20", name: "AMZN", merchantName: "Amazon", amount: 42, accountName: "Card", categoryId: "c1", categoryName: "Groceries", categoryColor: "var(--data-green)" },
  { id: "t2", date: "2026-06-19", name: "SBUX", merchantName: "Starbucks", amount: 6, accountName: "Card", categoryId: null, categoryName: null, categoryColor: null },
];

const categories: CategoryRow[] = [
  { id: "g1", name: "Food", kind: "group", parentId: null, color: null },
  { id: "c1", name: "Groceries", kind: "category", parentId: "g1", color: "var(--data-green)" },
  { id: "c2", name: "Coffee", kind: "category", parentId: "g1", color: "var(--data-orange)" },
];

/** The open picker — a row's trigger carries the same pill text as its option. */
function menu(): HTMLElement {
  return screen.getByRole("dialog", { name: "Choose category" });
}

function renderTile(overrides: Partial<Parameters<typeof TileToReview>[0]> = {}) {
  return render(
    <TileToReview
      items={items}
      count={2}
      error={false}
      editEnabled
      categories={categories}
      onMarkReviewed={() => {}}
      onMarkPage={() => {}}
      onPickCategory={() => {}}
      onOpen={() => {}}
      {...overrides}
    />,
  );
}

describe("TileToReview", () => {
  it("renders the count and reports checkmark clicks", () => {
    const onMark = vi.fn();
    renderTile({ onMarkReviewed: onMark });
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    expect(onMark).toHaveBeenCalledWith("t1");
  });

  it("reports mark-this-page clicks", () => {
    const onMarkPage = vi.fn();
    renderTile({ count: 20, onMarkPage });
    fireEvent.click(screen.getByRole("button", { name: /mark these reviewed/i }));
    expect(onMarkPage).toHaveBeenCalledTimes(1);
  });

  it("hides edit controls when editing is disabled", () => {
    renderTile({ editEnabled: false });
    expect(screen.queryByLabelText("Mark as reviewed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark these reviewed/i })).not.toBeInTheDocument();
    // The rows themselves are still visible and openable.
    expect(screen.getByText("Amazon")).toBeInTheDocument();
  });

  it("reports row opens and surfaces the error line", () => {
    const onOpen = vi.fn();
    renderTile({ error: true, onOpen });
    fireEvent.click(screen.getByText("Amazon"));
    expect(onOpen).toHaveBeenCalledWith("t1");
    expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument();
  });

  it("shows the caught-up state at zero", () => {
    renderTile({ items: [], count: 0 });
    expect(screen.getByText(/caught up/)).toBeInTheDocument();
  });

  // The category is the reason a row is in the queue at all, so it reads on the
  // row — same control as the Transactions page.
  it("shows each row's category, and Uncategorized for a row without one", () => {
    renderTile();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });

  it("recategorizes a row in place and reports which row was picked", () => {
    const onPickCategory = vi.fn();
    renderTile({ onPickCategory });
    // Second row ("Starbucks", uncategorized) — pick Coffee for it.
    fireEvent.click(screen.getAllByTitle("Change category")[1]);
    fireEvent.click(within(menu()).getByRole("button", { name: "Coffee" }));
    expect(onPickCategory).toHaveBeenCalledWith("t2", "c2");
  });

  it("clears a category back to uncategorized", () => {
    const onPickCategory = vi.fn();
    renderTile({ onPickCategory });
    fireEvent.click(screen.getAllByTitle("Change category")[0]);
    fireEvent.click(within(menu()).getByRole("button", { name: "Uncategorized" }));
    expect(onPickCategory).toHaveBeenCalledWith("t1", null);
  });

  it("shows the category read-only when editing is disabled", () => {
    renderTile({ editEnabled: false });
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.queryByTitle("Change category")).not.toBeInTheDocument();
  });
});
