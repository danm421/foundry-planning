// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WizardImportReview from "../wizard-import-review";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";

/**
 * Row name gives no retirement hint at all — the only way it can land in the
 * Retirement bucket is via its explicit link to `slot-retirement`. That link
 * only reaches `sumExtractedLivingByRole` if THIS wizard's OWN
 * `expenseCandidates` memo (wizard-import-review.tsx:160-165) carries `role`
 * through from `payload.expenseSlots` — this is the second, independent
 * producer of expense candidates (the Guided-setup import review), which
 * previously dropped `role` even after `review-wizard.tsx` was fixed.
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

describe("WizardImportReview — cash-flow step honors its own expenseCandidates role", () => {
  it("classifies a row by its explicit link to the Retirement slot, not by its name", () => {
    render(
      <WizardImportReview
        clientId="client-1"
        importId="import-1"
        step="cash-flow"
        payload={payloadWithRetirementLinkedRow()}
        perTabCommittedAt={null}
        onCommitted={() => {}}
        fileNames={{}}
      />,
    );

    expect(screen.getByText(/Retirement\s+\$9,000\s+from\s+1\s+row/)).toBeInTheDocument();
    // If `role` were dropped by this wizard's own candidate-building memo,
    // the row would fall back to name-based classification and fold into
    // Current instead — the exact bug this test pins.
    expect(screen.queryByText(/Current\s+\$9,000/)).toBeNull();
  });
});
