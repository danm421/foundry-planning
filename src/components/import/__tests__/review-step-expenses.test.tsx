// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ReviewStepExpenses from "@/components/import/review-step-expenses";
import type { ExtractedExpense } from "@/lib/extraction/types";
import type { MatchAnnotation } from "@/lib/imports/types";
import type { MatchCandidate } from "@/components/import/match-link-picker";

// The two seeded living-expense slots, carrying `role` the way
// review-wizard.tsx's `expenseCandidates` now threads it from
// `payload.expenseSlots` (see lib/imports/match.ts:274).
const LIVING_SLOTS: MatchCandidate[] = [
  { id: "slot-current", name: "Current Living Expenses", role: "current" },
  { id: "slot-retirement", name: "Retirement Living Expenses", role: "retirement" },
];

describe("ReviewStepExpenses type picker", () => {
  it("does not offer Living as a selectable type", () => {
    render(
      <ReviewStepExpenses
        expenses={[{ name: "Consulting", type: "other", startYear: 2026, endYear: 2060 }]}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2060}
      />,
    );
    expect(screen.queryByRole("option", { name: "Living" })).toBeNull();
    expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Insurance" })).toBeInTheDocument();
  });

  it("defaults a newly added row to type 'other', not 'living'", () => {
    let latest: ExtractedExpense[] = [];
    const { rerender } = render(
      <ReviewStepExpenses
        expenses={[]}
        onChange={(next) => {
          latest = next;
        }}
        defaultStartYear={2026}
        defaultEndYear={2060}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add Row" }));
    expect(latest).toHaveLength(1);
    expect(latest[0].type).toBe("other");

    // Re-render with the row onChange produced, and confirm the picker shows
    // it as "Other" rather than the amber "unset" tint — i.e. "other" really
    // is a recognized, selected option, not a value the picker can't display.
    rerender(
      <ReviewStepExpenses
        expenses={latest}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2060}
      />,
    );
    expect((screen.getByRole("option", { name: "Other" }) as HTMLOptionElement).selected).toBe(true);
  });
});

describe("ReviewStepExpenses living-bucket totals", () => {
  it("sums each row into the bucket its LINK targets, not the bucket its name suggests", () => {
    // Row 0 is named like a retirement line item but is explicitly linked to
    // the Current slot — Task 4's "an explicit link always wins" rule means
    // it must land in the Current total, not Retirement.
    const matches: Array<MatchAnnotation | undefined> = [
      { kind: "exact", existingId: "slot-current" },
      { kind: "exact", existingId: "slot-retirement" },
    ];
    render(
      <ReviewStepExpenses
        expenses={[
          { name: "Retirement Travel", type: "living", annualAmount: 12000, startYear: 2026, endYear: 2060 },
          { name: "Groceries", type: "living", annualAmount: 8000, startYear: 2026, endYear: 2060 },
        ]}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2060}
        matches={matches}
        onMatchChange={() => {}}
        candidates={LIVING_SLOTS}
      />,
    );

    expect(screen.getByText(/Current\s+\$12,000\s+from\s+1\s+row/)).toBeInTheDocument();
    expect(screen.getByText(/Retirement\s+\$8,000\s+from\s+1\s+row/)).toBeInTheDocument();
  });

  it("renders nothing when no row is extracted as living spending", () => {
    render(
      <ReviewStepExpenses
        expenses={[{ name: "Consulting", type: "other", annualAmount: 5000, startYear: 2026, endYear: 2060 }]}
        onChange={() => {}}
        defaultStartYear={2026}
        defaultEndYear={2060}
        candidates={LIVING_SLOTS}
      />,
    );
    expect(screen.queryByText("Living expenses are totalled into two rows")).toBeNull();
  });
});
