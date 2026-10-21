import { describe, expect, it } from "vitest";
import { reviewStatementHoldings } from "../holdings-checks";
import type { ExtractedAccount, ExtractedHolding } from "../types";
import {
  BROKERAGE_CORRECT_READ,
  BROKERAGE_READ_2026_10_21,
  BROKERAGE_TEXT,
  IRA_READ_2026_10_21,
  IRA_TEXT,
} from "./fixtures/schwab-statements-2026-04";

const byTicker = (holdings: ExtractedHolding[] | undefined, ticker: string) =>
  holdings?.find((h) => h.ticker === ticker);
const cash = (holdings: ExtractedHolding[] | undefined) => holdings?.find((h) => h.name === "Cash");

describe("reviewStatementHoldings — the Schwab brokerage read that put the gain in the basis", () => {
  const { account, warnings } = reviewStatementHoldings(BROKERAGE_READ_2026_10_21 as ExtractedAccount, BROKERAGE_TEXT);

  it("re-reads every basis and gain from its printed row", () => {
    expect(byTicker(account.holdings, "NVDA")).toMatchObject({ costBasis: 38008.19, unrealizedGain: 4407812.7 });
    expect(byTicker(account.holdings, "TSLA")).toMatchObject({ costBasis: 105235.55, unrealizedGain: 948063.25 });
    expect(byTicker(account.holdings, "AMZN")).toMatchObject({ costBasis: 35589.12, unrealizedGain: 290169.62 });
    expect(byTicker(account.holdings, "GOOGL")).toMatchObject({ costBasis: 17581.28, unrealizedGain: 510749.12 });
    expect(byTicker(account.holdings, "GOOG")).toMatchObject({ costBasis: 16842.65, unrealizedGain: 488845.91 });
    expect(byTicker(account.holdings, "T")).toMatchObject({ costBasis: 2014.81, unrealizedGain: -865.09 });
  });

  it("tells the advisor which positions it corrected", () => {
    expect(warnings.some((w) => w.includes("GOOGL, GOOG, AMZN") && w.includes("corrected to the statement's Cost Basis column"))).toBe(true);
  });

  it("keeps a printed N/A missing (QQQ's basis, SWKS's gain) instead of the model's 0 and -4.04", () => {
    expect(byTicker(account.holdings, "QQQ")?.costBasis).toBeUndefined();
    expect(byTicker(account.holdings, "SWKS")).toMatchObject({ costBasis: 2185.9 });
    expect(byTicker(account.holdings, "SWKS")?.unrealizedGain).toBeUndefined();
  });

  it("drops the money fund's beginning balance read as its basis, so the total matches $688,083.97", () => {
    expect(byTicker(account.holdings, "SWVXX")?.costBasis).toBeUndefined();
    expect(warnings.some((w) => w.includes("cost basis adds up to"))).toBe(false);
  });

  it("strips the 'Cash' ticker so cash is never priced as the CASH stock, and holds it at $1", () => {
    expect(cash(account.holdings)).toMatchObject({ price: 1 });
    expect(cash(account.holdings)?.ticker).toBeUndefined();
  });

  it("flags the cash balance the statement never printed ($22,518.53 for $22,598.53)", () => {
    expect(warnings.some((w) => w.includes("don't appear anywhere") && w.includes("Cash value $22,518.53"))).toBe(true);
  });
});

describe("reviewStatementHoldings — a faithful read of the same statement", () => {
  const { account, warnings } = reviewStatementHoldings(BROKERAGE_CORRECT_READ as ExtractedAccount, BROKERAGE_TEXT);

  it("raises nothing", () => {
    expect(warnings).toEqual([]);
  });

  it("keeps each position's printed cost basis, with the gain stored separately", () => {
    const expected: [string, number, number][] = [
      ["NVDA", 38008.19, 4407812.7],
      ["TSLA", 105235.55, 948063.25],
      ["AMZN", 35589.12, 290169.62],
      ["LRCX", 5339.48, 635958.34],
      ["GOOGL", 17581.28, 510749.12],
      ["GOOG", 16842.65, 488845.91],
      ["RVTY", 32675.18, 189331.88],
    ];
    for (const [ticker, costBasis, unrealizedGain] of expected) {
      expect(byTicker(account.holdings, ticker)).toMatchObject({ costBasis, unrealizedGain });
    }
  });

  it("keeps a loss in parentheses as a negative gain beside a positive basis", () => {
    expect(byTicker(account.holdings, "T")).toMatchObject({ costBasis: 2014.81, unrealizedGain: -865.09 });
  });

  it("keeps a missing basis missing (QQQ N/A) and a missing gain missing (SWKS N/A)", () => {
    expect(byTicker(account.holdings, "QQQ")?.costBasis).toBeUndefined();
    expect(byTicker(account.holdings, "SWKS")).toMatchObject({ costBasis: 2185.9 });
    expect(byTicker(account.holdings, "SWKS")?.unrealizedGain).toBeUndefined();
  });

  it("reads positions on every page — the last equity (ZM) sits alone on page 5", () => {
    expect(byTicker(account.holdings, "ZM")).toMatchObject({ costBasis: 4922.04 });
    expect(account.holdings).toHaveLength(39);
  });
});

describe("reviewStatementHoldings — the IRA read, which was right but for its cash", () => {
  const { account, warnings } = reviewStatementHoldings(IRA_READ_2026_10_21 as ExtractedAccount, IRA_TEXT);

  it("raises nothing: its positions' basis adds up to the statement's $1,165,469.41", () => {
    expect(warnings).toEqual([]);
    const sum = account.holdings!.reduce((s, h) => s + (h.costBasis ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(1165469.41);
  });

  it("takes the ENDING cash balance as the quantity, not the beginning one", () => {
    expect(cash(account.holdings)).toMatchObject({ shares: 45534.59, marketValue: 45534.59, price: 1 });
    expect(cash(account.holdings)?.ticker).toBeUndefined();
  });

  it("keeps every printed basis and drops AMGN's 0 for N/A", () => {
    expect(byTicker(account.holdings, "TSLA")).toMatchObject({ costBasis: 24362.38 });
    expect(byTicker(account.holdings, "AMZN")).toMatchObject({ costBasis: 20059.06 });
    expect(byTicker(account.holdings, "AMGN")?.costBasis).toBeUndefined();
  });
});

describe("reviewStatementHoldings — what the row reading re-reads, and what it leaves alone", () => {
  const acct = (holdings: ExtractedHolding[]): ExtractedAccount => ({ name: "Brokerage", holdings });
  const HEADER = "Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield % of Acct";
  const NVDA_ROW = "NVDA NVIDIA CORP (M) 1,000.0000 199.57000 199,570.00 12,345.67 187,224.33 0.02% 40.00 5%";

  it("passes over a summary line that names the ticker and its value, and reads the position's row", () => {
    const text = `Top Holdings NVDA NVIDIA CORP 199,570.00 5% ${HEADER} ${NVDA_ROW}`;
    const { account } = reviewStatementHoldings(
      acct([{ ticker: "NVDA", marketValue: 199570, costBasis: 187224.33 }]),
      text,
    );
    expect(byTicker(account.holdings, "NVDA")).toMatchObject({ costBasis: 12345.67, unrealizedGain: 187224.33 });
  });

  it("looks past an earlier mention outside the basis table that happens to print two figures", () => {
    const text = `Top Holdings NVDA NVIDIA CORP 199,570.00 1,234.00 5,678.00 ${HEADER} ${NVDA_ROW}`;
    const { account } = reviewStatementHoldings(
      acct([{ ticker: "NVDA", marketValue: 199570, costBasis: 187224.33 }]),
      text,
    );
    expect(byTicker(account.holdings, "NVDA")).toMatchObject({ costBasis: 12345.67 });
  });

  it("fills a basis the model left out without calling it a wrong-column read", () => {
    const { account, warnings } = reviewStatementHoldings(acct([{ ticker: "NVDA", marketValue: 199570 }]), `${HEADER} ${NVDA_ROW}`);
    expect(byTicker(account.holdings, "NVDA")).toMatchObject({ costBasis: 12345.67 });
    expect(warnings).toEqual([]);
  });

  it("finds a position whose value came back 0 by shares × price, across a wrapped price", () => {
    // A continuation pass returned a position with marketValue 0 and a garbled basis.
    const text = `${HEADER} GEV GE VERNOVA INC (M) 12.0000 1,083.4600 0 13,001.52 2,500.00 10,501.52 0.18% 24.00 <1%`;
    const { account } = reviewStatementHoldings(
      acct([{ ticker: "GEV", shares: 12, price: 1083.46, marketValue: 0, costBasis: 12501.52, unrealizedGain: 10501.52 }]),
      text,
    );
    expect(byTicker(account.holdings, "GEV")).toMatchObject({ marketValue: 13001.52, costBasis: 2500 });
  });

  it("does not re-read a cash table printed after the basis table — it prints no cost basis", () => {
    const text =
      `${HEADER} ${NVDA_ROW} Total Equities $199,570.00 $12,345.67 $187,224.33 ` +
      "Cash and Cash Investments Type Symbol Description Quantity Price($) Beginning Balance($) Ending Balance($) Change in Period Balance($) Pending/Unsettled Cash($) " +
      "Money Fund SWVXX SCHWAB PRIME ADVANTAGE 20,000.0000 1.0000 19,900.00 20,000.00 100.00 50.00 <1%";
    const { account, warnings } = reviewStatementHoldings(
      acct([{ ticker: "SWVXX", shares: 20000, price: 1, marketValue: 20000, costBasis: 20000 }]),
      text,
    );
    expect(byTicker(account.holdings, "SWVXX")).toMatchObject({ costBasis: 20000 });
    expect(byTicker(account.holdings, "SWVXX")?.unrealizedGain).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("keeps reading the table past a fund named TOTAL — only a total line with its $ amount ends it", () => {
    const text = `${HEADER} VTI VANGUARD TOTAL STOCK MKT ETF 100.0000 250.00000 25,000.00 10,000.00 15,000.00 1.2% 300.00 1% ${NVDA_ROW}`;
    const { account } = reviewStatementHoldings(
      acct([{ ticker: "NVDA", marketValue: 199570, costBasis: 187224.33 }]),
      text,
    );
    expect(byTicker(account.holdings, "NVDA")).toMatchObject({ costBasis: 12345.67 });
  });

  it("leaves a layout that prints the cost before the market value (Merrill) to the checks", () => {
    const text =
      "Symbol Description Quantity Unit Cost Total Cost Basis Market Price Market Value Unrealized Gain/(Loss) Est. Annual Income " +
      "AAPL APPLE INC 100 81.89 8,189.00 271.35 27,135.00 18,946.00 104.00";
    const { account, warnings } = reviewStatementHoldings(
      acct([{ ticker: "AAPL", marketValue: 27135, costBasis: 8189 }]),
      text,
    );
    expect(byTicker(account.holdings, "AAPL")?.costBasis).toBe(8189);
    expect(warnings).toEqual([]);
  });

  it("reads GOOG's row, not GOOGL's, though one ticker starts the other", () => {
    const text =
      `${HEADER} GOOGL ALPHABET INC (M) 100.0000 384.80000 38,194.00 1.00 38,193.00 4% ` +
      "GOOG ALPHABET INC (M) 100.0000 381.94000 38,194.00 1,234.56 36,959.44 0.21% 84.00 1%";
    const { account } = reviewStatementHoldings(
      acct([{ ticker: "GOOG", marketValue: 38194, costBasis: 36959.44 }]),
      text,
    );
    expect(byTicker(account.holdings, "GOOG")).toMatchObject({ costBasis: 1234.56 });
  });
});

describe("reviewStatementHoldings — each check alone", () => {
  const acct = (holdings: ExtractedHolding[], basis?: number): ExtractedAccount => ({ name: "Brokerage", basis, holdings });

  it("flags a row whose market value − basis misses its printed gain, but not a rounding cent", () => {
    const text = "1,000.00 400.00 600.00 2,000.00 1,500.00 300.00";
    const { warnings } = reviewStatementHoldings(
      acct([
        { ticker: "OK", marketValue: 1000, costBasis: 400, unrealizedGain: 600.4 },
        { ticker: "BAD", marketValue: 2000, costBasis: 1500, unrealizedGain: 300 },
      ]),
      text,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/doesn't match the statement's unrealized gain\/\(loss\) for BAD\./);
  });

  it("catches basis and gain swapped on every row through the account's total basis", () => {
    const text = "Cost Basis 1,000.00 1,000.00 900.00 100.00 2,000.00 1,900.00 100.00";
    const { warnings } = reviewStatementHoldings(
      acct(
        [
          { ticker: "A", marketValue: 1000, costBasis: 900, unrealizedGain: 100 },
          { ticker: "B", marketValue: 2000, costBasis: 1900, unrealizedGain: 100 },
        ],
        200,
      ),
      text,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/adds up to \$2,800\.00, but the statement's total cost basis is \$200\.00/);
  });

  it("skips the total when the statement prints none, and the printed check when there is no text", () => {
    const { warnings } = reviewStatementHoldings(acct([{ ticker: "A", marketValue: 1000, costBasis: 999 }]), "");
    expect(warnings).toEqual([]);
  });

  it("finds two amounts a text layer ran together", () => {
    const { warnings } = reviewStatementHoldings(
      acct([{ ticker: "A", marketValue: 38480, costBasis: 1234.56 }]),
      "A 100.0000 384.80000 38,480.001,234.56",
    );
    expect(warnings).toEqual([]);
  });

  it("names eight positions, then counts the rest", () => {
    const holdings = Array.from({ length: 10 }, (_, i) => ({ ticker: `T${i}`, marketValue: 100, costBasis: -5 }));
    const { warnings } = reviewStatementHoldings(acct(holdings), "100.00");
    expect(warnings[0]).toMatch(/T0, T1, T2, T3, T4, T5, T6, T7 and 2 more came back with a negative cost basis/);
  });
});
