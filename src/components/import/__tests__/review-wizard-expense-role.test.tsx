// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReviewWizard from "@/components/import/review-wizard";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";
import type { GrowthContext } from "@/lib/investments/growth-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-1",
}));

const growthContext: GrowthContext = {
  modelPortfolios: [],
  fundPortfolios: [],
  resolvedInflationRate: 0.03,
  categoryDefaults: {},
};

const baseProps = {
  clientId: "client-1",
  importId: "import-1",
  defaultStartYear: 2026,
  defaultEndYear: 2076,
  growthContext,
  fileNames: {},
};

/**
 * Row name gives no retirement hint at all — the only way it can land in the
 * Retirement bucket is via its explicit link to `slot-retirement`. That link
 * only reaches `sumExtractedLivingByRole` if `ReviewWizard`'s OWN
 * `expenseCandidates` memo (review-wizard.tsx:509-514) actually carries
 * `role` through from `payload.expenseSlots` — this exercises that real
 * mapping, not a hand-built fixture that hands `role` in ready-made.
 */
function payloadWithRetirementLinkedRow(): ImportPayload {
  return {
    ...emptyImportPayload(),
    expenseSlots: [
      { id: "slot-current", name: "Current Living Expenses", role: "current" },
      { id: "slot-retirement", name: "Retirement Living Expenses", role: "retirement" },
    ],
    expenses: [
      {
        name: "Groceries",
        type: "living",
        annualAmount: 9000,
        match: { kind: "exact", existingId: "slot-retirement" },
      },
    ],
  };
}

describe("ReviewWizard — Expenses tab honors the wizard's own expenseCandidates role", () => {
  it("classifies a row by its explicit link to the Retirement slot, not by its name", () => {
    render(
      <ReviewWizard
        {...baseProps}
        payload={payloadWithRetirementLinkedRow()}
        perTabCommittedAt={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Expenses/ }));

    expect(screen.getByText(/Retirement\s+\$9,000\s+from\s+1\s+row/)).toBeInTheDocument();
    // If `role` were dropped by the wizard's own candidate-building memo, this
    // row would fall back to name-based classification, fail to read as
    // retirement ("Groceries" has no retirement keyword), and be folded into
    // Current instead — the exact bug this test pins.
    expect(screen.queryByText(/Current\s+\$9,000/)).toBeNull();
  });
});
