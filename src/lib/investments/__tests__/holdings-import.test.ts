import { describe, it, expect } from "vitest";
import {
  HOLDINGS_IMPORT_HEADER_ROW,
  MAX_IMPORT_HOLDINGS,
  readHoldingsGrid,
  toImportHolding,
  toStatementRead,
} from "../holdings-import";

const HEADER = ["Ticker", "Name", "Shares", "Price", "Market Value", "Cost Basis"];

describe("HOLDINGS_IMPORT_HEADER_ROW", () => {
  it("is tab-separated so a paste into Excel fills one cell per column", () => {
    expect(HOLDINGS_IMPORT_HEADER_ROW).toBe(HEADER.join("\t"));
  });
});

describe("readHoldingsGrid", () => {
  it("reads the template's own columns", () => {
    const result = readHoldingsGrid([
      HEADER,
      ["vti", "Vanguard Total Stock Market ETF", 100, 250.5, 25050, 18000],
    ]);
    expect(result).toEqual({
      ok: true,
      holdings: [
        {
          ticker: "VTI",
          name: "Vanguard Total Stock Market ETF",
          shares: 100,
          price: 250.5,
          marketValue: 25050,
          costBasis: 18000,
        },
      ],
      warnings: [],
    });
  });

  it("matches custodian header names in any order and ignores extra columns", () => {
    const result = readHoldingsGrid([
      ["Symbol", "Description", "Quantity", "Last Price", "Current Value", "Day Change %", "Cost Basis Total"],
      ["AAPL", "APPLE INC", "10", "$190.00", "$1,900.00", "1.2%", "$1,200.00"],
    ]);
    expect(result.ok && result.holdings).toEqual([
      { ticker: "AAPL", name: "APPLE INC", shares: 10, price: 190, marketValue: 1900, costBasis: 1200 },
    ]);
  });

  it("finds the header row below a custodian's title lines", () => {
    const result = readHoldingsGrid([
      ["Positions for account Individual ...123 as of 10/30/2026"],
      [],
      ["Symbol", "Quantity", "Market Value"],
      ["VXUS", 50, 3100],
    ]);
    expect(result.ok && result.holdings).toEqual([{ ticker: "VXUS", shares: 50, marketValue: 3100 }]);
  });

  it("refuses a sheet with no recognizable header row", () => {
    const result = readHoldingsGrid([["foo", "bar"], [1, 2]]);
    expect(result.ok).toBe(false);
  });

  it("needs a ticker or a name plus shares or a market value to call a row a header", () => {
    // Ticker alone isn't enough: the row below could be anything.
    expect(readHoldingsGrid([["Ticker", "Notes"], ["VTI", "x"]]).ok).toBe(false);
  });

  it("keeps an untickered position by its name (bonds, cash)", () => {
    const result = readHoldingsGrid([
      HEADER,
      ["", "US TREASURY NOTE 4.25% 2030", "", "", 50000, 49000],
      ["", "Cash", "", "", 1234.56, ""],
    ]);
    expect(result.ok && result.holdings).toEqual([
      { name: "US TREASURY NOTE 4.25% 2030", marketValue: 50000, costBasis: 49000 },
      { name: "Cash", marketValue: 1234.56 },
    ]);
  });

  it("skips blank rows silently and total rows with no warning noise", () => {
    const result = readHoldingsGrid([
      HEADER,
      ["VTI", "", 1, 200, "", ""],
      ["", "", "", "", "", ""],
      [],
      ["Account Total", "", "", "", 200, ""],
      ["", "Total", "", "", 200, ""],
    ]);
    expect(result).toEqual({
      ok: true,
      holdings: [{ ticker: "VTI", shares: 1, price: 200 }],
      warnings: [],
    });
  });

  it("skips a row with neither shares nor a market value, and says so", () => {
    const result = readHoldingsGrid([HEADER, ["VTI", "", "", 200, "", ""]]);
    expect(result.ok && result.holdings).toEqual([]);
    expect(result.ok && result.warnings).toEqual(["Row 2 (VTI): no shares or market value — skipped."]);
  });

  it("skips a row with a negative quantity or value", () => {
    const result = readHoldingsGrid([HEADER, ["TSLA", "", -5, 200, -1000, ""]]);
    expect(result.ok && result.holdings).toEqual([]);
    expect(result.ok && result.warnings).toEqual([
      "Row 2 (TSLA): negative shares, price or value — skipped.",
    ]);
  });

  it("reads accounting negatives and drops a non-positive cost basis", () => {
    const result = readHoldingsGrid([HEADER, ["VTI", "", 1, 200, 200, "(50.00)"]]);
    expect(result.ok && result.holdings).toEqual([{ ticker: "VTI", shares: 1, price: 200, marketValue: 200 }]);
  });

  it("treats placeholders like -- and n/a as empty", () => {
    const result = readHoldingsGrid([HEADER, ["VTI", "", 2, "--", "n/a", "N/A"]]);
    expect(result.ok && result.holdings).toEqual([{ ticker: "VTI", shares: 2 }]);
  });

  it("names an unreadable number in a warning and imports the rest of the row", () => {
    const result = readHoldingsGrid([HEADER, ["VTI", "", "ten", 200, 2000, ""]]);
    expect(result.ok && result.holdings).toEqual([{ ticker: "VTI", price: 200, marketValue: 2000 }]);
    expect(result.ok && result.warnings).toEqual([`Row 2 (VTI): couldn't read Shares "ten" — left blank.`]);
  });

  it("strips a custodian's footnote asterisks from a ticker", () => {
    const result = readHoldingsGrid([HEADER, ["SPAXX**", "FIDELITY GOVERNMENT MONEY MARKET", 500, 1, 500, ""]]);
    expect(result.ok && result.holdings[0].ticker).toBe("SPAXX");
  });

  it(`stops at ${MAX_IMPORT_HOLDINGS} positions and says so`, () => {
    const rows = Array.from({ length: MAX_IMPORT_HOLDINGS + 3 }, (_, i) => [`T${i}`, "", 1, 1, 1, ""]);
    const result = readHoldingsGrid([HEADER, ...rows]);
    expect(result.ok && result.holdings).toHaveLength(MAX_IMPORT_HOLDINGS);
    expect(result.ok && result.warnings).toEqual([
      `Only the first ${MAX_IMPORT_HOLDINGS} positions were read.`,
    ]);
  });
});

describe("toImportHolding", () => {
  it("keeps only the fields an import writes, clamped to what a holding stores", () => {
    expect(
      toImportHolding({
        ticker: " vti ",
        name: "x".repeat(250),
        shares: 1,
        price: 2,
        marketValue: 2,
        costBasis: 1,
        unrealizedGain: 1,
        __holdingId: "h1",
      }),
    ).toEqual({ ticker: "VTI", name: "x".repeat(200), shares: 1, price: 2, marketValue: 2, costBasis: 1 });
  });

  it("drops a ticker too long to be one, keeping the name", () => {
    expect(toImportHolding({ ticker: "A".repeat(40), name: "Thing", marketValue: 5 })).toEqual({
      name: "Thing",
      marketValue: 5,
    });
  });
});

describe("toStatementRead", () => {
  const joint = { name: "Joint", accountNumberLast4: "1111", holdings: [{ ticker: "AAPL", shares: 1 }] };
  const ira = { name: "IRA", accountNumberLast4: "2222", holdings: [{ ticker: "VTI", shares: 2 }] };

  it("points at the one account whose last 4 match", () => {
    expect(toStatementRead([joint, ira], "2222", []).matchIndex).toBe(1);
  });

  it("points at none when this account has no last 4, or two accounts share it", () => {
    expect(toStatementRead([joint, ira], null, []).matchIndex).toBeNull();
    expect(toStatementRead([joint, { ...ira, accountNumberLast4: "1111" }], "1111", []).matchIndex).toBeNull();
  });

  it("skips a line the save would refuse, says so, and drops an account left empty", () => {
    const read = toStatementRead(
      [joint, { name: "Margin", holdings: [{ ticker: "TSLA", shares: -5, marketValue: -1000 }] }],
      null,
      ["from the read"],
    );
    expect(read.accounts.map((a) => a.name)).toEqual(["Joint"]);
    expect(read.warnings).toEqual([
      "from the read",
      "Margin (TSLA): negative shares, price or value — skipped.",
    ]);
  });

  it("says so when nothing on the statement can be imported", () => {
    const read = toStatementRead([{ name: "Checking", holdings: [] }], null, []);
    expect(read).toEqual({
      accounts: [],
      matchIndex: null,
      warnings: ["No holdings could be read off this document."],
    });
  });
});
