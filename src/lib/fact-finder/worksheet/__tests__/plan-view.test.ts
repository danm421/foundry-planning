import { describe, expect, it } from "vitest";
import { emptyExistingRecords } from "../../records/types";
import { planView } from "../plan-view";

describe("planView", () => {
  it("lists each kind with ids and figures, (none) when empty", () => {
    const r = emptyExistingRecords();
    r.candidates.accounts.push({ id: "a1", name: "Joint IRA", category: "retirement", accountNumberLast4: "1234", custodian: "Schwab", value: 431050 });
    r.candidates.liabilities.push({ id: "l1", name: "Mortgage", balance: 250000 });
    r.notesReceivable.push({ id: "n1", name: "Loan to Sam", faceValue: 5000 });
    r.ltcPolicies.push({ id: "p1", name: "LTC", insured: "Dan", carrier: "Genworth" });
    const out = planView(r);
    expect(out).toContain("## Accounts\n- a1 Joint IRA, retirement, Schwab, last 4 1234, value $431,050");
    expect(out).toContain("- l1 Mortgage, balance $250,000");
    expect(out).toContain("- n1 Loan to Sam, face value $5,000");
    expect(out).toContain("- p1 LTC, insured Dan, Genworth");
    expect(out).toContain("## Incomes\n(none)");
    expect(out).toContain("## Gifts\n(none)");
    expect(out).toContain("## Wills\n(none)");
  });
});
