// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

describe("ReviewStepAccounts name display", () => {
  it("shows the existing account name, not the extracted one, on a matched row", () => {
    render(
      <ReviewStepAccounts
        accounts={[
          { name: "JOHN SMITH ROLLOVER IRA XXXX-1234", category: "retirement", value: 100 },
        ]}
        onChange={() => {}}
        matches={[{ kind: "exact", existingId: "acct-1" }]}
        existingAccountsById={{ "acct-1": { name: "Fidelity Rollover IRA" } }}
        candidates={[{ id: "acct-1", name: "Fidelity Rollover IRA" }]}
        onMatchChange={() => {}}
      />,
    );

    // MatchColumn's "exact" badge already renders `existingName` inline
    // (match-column.tsx), so a bare getByText("Fidelity Rollover IRA") is
    // ambiguous once the Name block also shows it — scope to the Name
    // field's own container, found via its <label>.
    const nameField = screen.getByText("Name").closest("div") as HTMLElement;
    expect(within(nameField).getByText("Fidelity Rollover IRA")).toBeInTheDocument();
    expect(
      screen.getByText(/from document: JOHN SMITH ROLLOVER IRA XXXX-1234/),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("JOHN SMITH ROLLOVER IRA XXXX-1234"),
    ).not.toBeInTheDocument();
  });

  it("keeps the name editable on an unmatched row", () => {
    render(
      <ReviewStepAccounts
        accounts={[{ name: "Fidelity Rollover IRA", category: "retirement", value: 100 }]}
        onChange={() => {}}
        matches={[{ kind: "new" }]}
        onMatchChange={() => {}}
      />,
    );

    expect(screen.getByDisplayValue("Fidelity Rollover IRA")).toBeInTheDocument();
  });
});
