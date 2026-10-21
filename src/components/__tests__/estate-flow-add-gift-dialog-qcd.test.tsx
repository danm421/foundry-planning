// @vitest-environment jsdom
//
// The Estate Flow tab's gift dialog builds its own list of IRAs a QCD can come
// from out of the plan's accounts and people. These pin that build: "From an
// IRA" appears for a public charity only when the household has an eligible
// IRA, and an inherited IRA reaches the form marked as one.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EstateFlowAddGiftDialog from "@/components/estate-flow-add-gift-dialog";
import { buildClientData, sampleAccounts } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import type { Account } from "@/engine/types";

/** John (the client, born January 1970): 70½ in 2040, RMDs from 2045. */
const johnIra = (over: Partial<Account> = {}): Account => ({
  id: "acct-ira",
  name: "John IRA",
  category: "retirement",
  subType: "traditional_ira",
  titlingType: "jtwros",
  value: 400_000,
  basis: 0,
  growthRate: 0.05,
  rmdEnabled: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  ...over,
});

function renderDialog(accounts: Account[]) {
  render(
    <EstateFlowAddGiftDialog
      clientData={buildClientData({
        accounts,
        externalBeneficiaries: [
          { id: "pub", name: "Red Cross", kind: "charity", charityType: "public" },
          { id: "priv", name: "Family Foundation", kind: "charity", charityType: "private" },
        ],
      })}
      ledger={[]}
      taxInflationRate={0.025}
      annualExclusionByYear={{}}
      editing={null}
      onApply={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}
const pick = (v: string) => fireEvent.change(screen.getByTestId("recipient"), { target: { value: v } });

describe("EstateFlowAddGiftDialog — QCD sources", () => {
  it("offers From an IRA for a public charity, listing the client's IRA", () => {
    renderDialog([...sampleAccounts, johnIra()]);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    const opts = [...(screen.getByTestId("qcd-account") as HTMLSelectElement).options].map((o) => o.textContent);
    // The fixture's 401(k) and Roth IRA can't fund a QCD.
    expect(opts).toEqual(["— select —", "John IRA (John)"]);
  });

  it("does not offer it for a private charity", () => {
    renderDialog([...sampleAccounts, johnIra()]);
    pick("external_beneficiary:priv");
    expect(screen.queryByText("From an IRA")).toBeNull();
  });

  it("does not offer it when no account can fund a QCD", () => {
    renderDialog(sampleAccounts);
    pick("external_beneficiary:pub");
    expect(screen.queryByText("From an IRA")).toBeNull();
  });

  function fullRmdIn2041() {
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "acct-ira" } });
    fireEvent.click(screen.getByText("Full RMD"));
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2041" } });
  }

  it("notes that a Full RMD QCD from the client's own IRA gives nothing before his RMDs start", () => {
    renderDialog([johnIra()]);
    fullRmdIn2041();
    expect(screen.getByText("John's RMDs start in 2045; a Full RMD QCD gives nothing before then.")).toBeInTheDocument();
  });

  it("leaves the note off for an inherited IRA, whose RMDs are already due", () => {
    renderDialog([johnIra({ inheritedDeathYear: 2020, inheritedOwnerBirthYear: 1945 })]);
    fullRmdIn2041();
    expect(screen.queryByText(/RMDs start in/)).toBeNull();
  });
});
