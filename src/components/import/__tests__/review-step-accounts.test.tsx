// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
      screen.getByText(/extracted: JOHN SMITH ROLLOVER IRA XXXX-1234/),
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

describe("ReviewStepAccounts 529 fields", () => {
  const ROSTER = [
    { id: "fm-client", role: "client" as const, firstName: "John", lastName: "Smith" },
    { id: "fm-spouse", role: "spouse" as const, firstName: "Jane", lastName: "Smith" },
    { id: "fm-kid", role: "child" as const, firstName: "Emma", lastName: "Smith" },
  ];

  function render529(
    account: Partial<ExtractedAccount>,
    onChange: (a: ExtractedAccount[]) => void = () => {},
  ) {
    return render(
      <ReviewStepAccounts
        accounts={[{ name: "529 Plan", category: "education_savings", subType: "529", ...account }]}
        onChange={onChange}
        familyMembers={ROSTER}
      />,
    );
  }

  it("drops the RMD control on a 529 and keeps it on a retirement account", () => {
    // A 529 has no required minimum distribution at any age. Leaving the
    // checkbox on the row invites an advisor to tick a box the engine would
    // then honour on an account that can never have one.
    render529({});
    expect(screen.queryByText("Take RMDs")).not.toBeInTheDocument();

    screen.getByText("Accounts (1 found)"); // sanity: the row did render
  });

  it("still offers the RMD control on a non-529 row", () => {
    render(
      <ReviewStepAccounts
        accounts={[{ name: "Trad IRA", category: "retirement", subType: "traditional_ira" }]}
        onChange={() => {}}
        familyMembers={ROSTER}
      />,
    );
    expect(screen.getByText("Take RMDs")).toBeInTheDocument();
  });

  it("treats subType 529 alone as a 529, even when the category says taxable", () => {
    // Older payloads (and a model that ignores the rule) classify 529s as
    // taxable + subType "529"; commitAccounts heals the category, so the row
    // must present as a 529 here too or the advisor never sees the beneficiary.
    render(
      <ReviewStepAccounts
        accounts={[{ name: "College Fund", category: "taxable", subType: "529" }]}
        onChange={() => {}}
        familyMembers={ROSTER}
      />,
    );
    expect(screen.queryByText("Take RMDs")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Beneficiary")).toBeInTheDocument();
  });

  it("replaces the ownership editor with the beneficiary + grantor pair", () => {
    render529({ beneficiaryFamilyMemberId: "fm-kid" });
    expect(screen.getByLabelText("Beneficiary")).toHaveValue("fm-kid");
    expect(screen.getByLabelText("Grantor")).toBeInTheDocument();
    expect(screen.queryByText("Owner(s)")).not.toBeInTheDocument();
  });

  it("flags a 529 with no beneficiary as required", () => {
    render529({});
    expect(
      screen.getByText(/Required — a 529 is attributed to its designated beneficiary\./),
    ).toBeInTheDocument();
  });

  it("seeds the beneficiary from the statement's name hint when it matches the roster", () => {
    const onChange = vi.fn();
    render529({ beneficiaryNameHint: "Emma Smith" }, onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ beneficiaryFamilyMemberId: "fm-kid" });
  });

  it("keeps an unmatched beneficiary hint as a free-text name rather than guessing", () => {
    // Attributing a 529 to the wrong child moves its whole balance to the
    // wrong person's education goal, so an unmatched hint must NOT resolve.
    const onChange = vi.fn();
    render529({ beneficiaryNameHint: "Tobias Funke" }, onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    const seeded = onChange.mock.calls[0][0][0];
    // Explicitly null, not absent: seeding writes BOTH halves of the pair, the
    // same shape the picker writes, so exactly one of them is ever set.
    expect(seeded.beneficiaryFamilyMemberId).toBeNull();
    expect(seeded.beneficiaryName).toBe("Tobias Funke");
  });

  it("does not seed owners[] on a 529 — the commit writes none", () => {
    const onChange = vi.fn();
    render529({ ownerNameHint: "John A. Smith", owner: "client" }, onChange);
    // Only the 529 people may be seeded; with no hints there is nothing to do.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the statement's printed name alongside a resolved pick", () => {
    render529({ beneficiaryNameHint: "Emma Smith", beneficiaryFamilyMemberId: "fm-kid" });
    expect(screen.getByText("Statement: Emma Smith")).toBeInTheDocument();
  });

  it("offers only the client and spouse as household grantors", () => {
    render529({ beneficiaryFamilyMemberId: "fm-kid" });
    const grantor = screen.getByLabelText("Grantor") as HTMLSelectElement;
    const names = Array.from(grantor.options).map((o) => o.textContent);
    expect(names).toContain("John");
    expect(names).toContain("Jane");
    // A child can't fund the plan out of household cash flow — the outside
    // grantor escape hatch covers a grandparent participant instead.
    expect(names).not.toContain("Emma");
    expect(names).toContain("Someone else…");
  });

  it("clears the paired name when a roster member is picked", () => {
    const onChange = vi.fn();
    render529({ beneficiaryName: "Emma Smith" }, onChange);
    fireEvent.change(screen.getByLabelText("Beneficiary"), { target: { value: "fm-kid" } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ beneficiaryFamilyMemberId: "fm-kid", beneficiaryName: null }),
    ]);
  });

  it("drops a stale RMD flag when a row is reclassified into a 529", () => {
    // The checkbox disappears with the category, so a `true` left behind would
    // reach the commit where the advisor can no longer see or clear it.
    const onChange = vi.fn();
    render(
      <ReviewStepAccounts
        accounts={[
          { name: "Trad IRA", category: "retirement", subType: "traditional_ira", rmdEnabled: true },
        ]}
        onChange={onChange}
        familyMembers={ROSTER}
      />,
    );
    const categorySelect = screen.getByRole("option", { name: "Taxable" }).closest("select")!;
    fireEvent.change(categorySelect, { target: { value: "education_savings" } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ category: "education_savings", rmdEnabled: false }),
    ]);
  });
});
