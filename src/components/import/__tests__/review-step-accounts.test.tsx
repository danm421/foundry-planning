// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewStepAccounts from "@/components/import/review-step-accounts";
import type { ExtractedAccount } from "@/lib/extraction/types";
import { ACCOUNT_CATEGORY_LABELS } from "@/lib/accounts/category-labels";

describe("ReviewStepAccounts category picker", () => {
  it("offers education_savings as a selectable account category", () => {
    // The account-statement extraction prompt (src/lib/extraction/prompts/
    // account-statement.ts) routes 529 / Coverdell accounts to category
    // "education_savings". CATEGORY_OPTIONS is a hand-maintained subset of
    // AccountCategory, so tsc can't catch it falling out of sync — this test
    // is the guard.
    const accounts: ExtractedAccount[] = [{ name: "529 College Fund", category: "education_savings" }];
    render(<ReviewStepAccounts accounts={accounts} onChange={() => {}} />);

    // The "Category" <label> has no htmlFor/id link to its <select>, so
    // locate the select via an option we know it carries.
    const taxableOption = screen.getByRole("option", { name: "Taxable" });
    const categorySelect = taxableOption.closest("select");
    expect(categorySelect).not.toBeNull();

    const educationOption = categorySelect!.querySelector('option[value="education_savings"]');
    expect(educationOption).not.toBeNull();
    // Label should match the canonical category label used everywhere else
    // in the app, not a bespoke string invented for this picker.
    expect(educationOption!.textContent).toBe(ACCOUNT_CATEGORY_LABELS.education_savings);
  });
});
