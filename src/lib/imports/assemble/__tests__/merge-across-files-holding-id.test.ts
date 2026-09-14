// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mergeAcrossFiles } from "../merge-across-files";

const holding = (ticker?: string, name?: string) => ({ ticker, name, marketValue: 100 });

function oneFile(accounts: unknown[]) {
  return {
    "file-a": {
      fileName: "a.pdf",
      documentType: "account_statement",
      extracted: { accounts, incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [] },
      warnings: [],
    },
  } as never;
}

describe("mergeAcrossFiles — __holdingId", () => {
  it("keys a tickered position on its ticker and an untickered one on its name", () => {
    const { payload } = mergeAcrossFiles(
      oneFile([{ name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 200,
        holdings: [holding("aapl"), holding(undefined, "US Treasury 2031")] }]),
    );
    expect(payload.accounts[0].holdings?.map((h) => h.__holdingId)).toEqual([
      "t:AAPL#0",
      "n:US TREASURY 2031#0",
    ]);
  });

  it("disambiguates two positions that share a key with an occurrence suffix", () => {
    const { payload } = mergeAcrossFiles(
      oneFile([{ name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 200,
        holdings: [holding(undefined, "Cash"), holding(undefined, "Cash")] }]),
    );
    expect(payload.accounts[0].holdings?.map((h) => h.__holdingId)).toEqual(["n:CASH#0", "n:CASH#1"]);
  });

  it("scopes ids per account, so the same ticker in two accounts is not one id", () => {
    const { payload } = mergeAcrossFiles(
      oneFile([
        { name: "Taxable", accountNumberLast4: "1111", custodian: "Schwab", value: 100, holdings: [holding("VTI")] },
        { name: "IRA", accountNumberLast4: "2222", custodian: "Schwab", value: 100, holdings: [holding("VTI")] },
      ]),
    );
    const [a, b] = payload.accounts;
    expect(a.holdings?.[0].__holdingId).toBe("t:VTI#0");
    expect(b.holdings?.[0].__holdingId).toBe("t:VTI#0");
    // Same string, different rows — identity is (rowId, holdingId), never
    // holdingId alone. Pinned so nobody "fixes" this into a global counter.
    expect(a.__rowId).not.toBe(b.__rowId);
  });

  it("leaves an account with no holdings untouched", () => {
    const { payload } = mergeAcrossFiles(
      oneFile([{ name: "Checking", accountNumberLast4: "9999", custodian: "Chase", value: 50 }]),
    );
    expect(payload.accounts[0].holdings).toBeUndefined();
  });

  // Documented at `merge-across-files.ts`: "Idempotent — re-stamping a
  // payload that already carries ids produces the same ids." Nothing
  // exercised that claim until now — `mergeRows` (Task 2, fix round 1)
  // depends on it holding, since it re-stamps a row's WHOLE holdings array
  // unconditionally rather than only the positions that just arrived.
  it("stamping the same payload twice produces identical ids", () => {
    const { payload: first } = mergeAcrossFiles(
      oneFile([{ name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 200,
        holdings: [holding("aapl"), holding(undefined, "Cash"), holding(undefined, "Cash")] }]),
    );
    const idsAfterFirstStamp = first.accounts[0].holdings?.map((h) => h.__holdingId);

    const { payload: second } = mergeAcrossFiles(
      oneFile([{ name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 200,
        // Same positions, but already carrying the ids the first merge minted —
        // simulating a re-run over a payload that has already been stamped.
        holdings: first.accounts[0].holdings }]),
    );
    const idsAfterSecondStamp = second.accounts[0].holdings?.map((h) => h.__holdingId);

    expect(idsAfterSecondStamp).toEqual(idsAfterFirstStamp);
    expect(idsAfterFirstStamp).toEqual(["t:AAPL#0", "n:CASH#0", "n:CASH#1"]);
  });
});
