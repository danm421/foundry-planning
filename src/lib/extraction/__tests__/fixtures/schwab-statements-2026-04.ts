/**
 * Two Schwab statements for April 2026 — a margin brokerage account and a
 * contributory IRA — laid out as the extractor saw them, and the mistakes the
 * model made reading them on 2026-10-21. The layout is the positions pages'
 * own, with the PDF's artifacts: the "(M)" marginable flag, a price that
 * wraps ("1,083.4600 0"), "N/A i" for a missing basis, losses in parentheses
 * and a table continued over three pages. The quantities, values, bases,
 * gains, income, balances, totals and account numbers are synthetic, replaced
 * consistently (value − basis = gain, rows sum to totals); the April 30
 * prices and yields and the month's few cash-flow amounts are as printed.
 *
 * Each position row is `[ticker, name, shares, price, marketValue, costBasis,
 * unrealizedGain, readCostBasis]`: the first seven as printed (null = "N/A"),
 * the last what the model returned as its cost basis.
 */

type Row = [string, string, number, number, number, number | null, number | null, number | undefined];

export const BROKERAGE_TEXT =
  "Statement Period April 1-30, 2026 Schwab One® Account of Positions - Summary Beginning Value as of 04/01 + Transfer of Securities(In/Out) + Dividends Reinvested + Cash Activity + Change in Market Value = Ending Value as of 04/30 Cost Basis Unrealized Gain/(Loss) $8,135,198.23 $0.00 ($128.66) $1,246.82 $1,108,227.05 $9,244,543.44 $688,083.97 i $8,275,484.95 i " +
  "Cash and Cash Investments Type Symbol Description Quantity Price($) Beginning Balance($) Ending Balance($) Change in Period Balance($) Pending/Unsettled Cash($) Interest/ Yield Rate % of Acct Cash , 21,480.37 22,598.53 1,118.16 363.07 <1% Money Fund (Non-Sweep) SWVXX SCHWAB PRIME ADVANTAGE M,(M) 27,314.6200 1.0000 27,185.96 27,314.62 128.66 <1% Total Cash and Cash Investments $48,666.33 $49,913.15 $1,246.82 1% " +
  "Positions - Equities Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct GOOGL ALPHABET INC (M) 1,373.0000 384.80000 528,330.40 17,581.28 510,749.12 0.21% 1,153.32 4% GOOG ALPHABET INC (M) 1,324.0000 381.94000 505,688.56 16,842.65 488,845.91 0.21% 1,112.16 4% AMZN AMAZON.COM INC (M) 1,229.0000 265.06000 325,758.74 35,589.12 290,169.62 N/A N/A 10% AAPL APPLE INC (M) 480.0000 271.35000 130,248.00 39,308.16 90,939.84 0.38% 499.20 2% T AT&T INC (M) 44.0000 26.13000 1,149.72 2,014.81 (865.09) 4.24% 48.84 <1% BAC BANK OF AMERICA CORP (M) 982.0000 53.46000 52,497.72 5,175.03 47,322.69 2.09% 1,099.84 <1% BIIB BIOGEN INC (M) 27.0000 189.28000 5,110.56 1,363.96 3,746.60 N/A N/A <1% XYZ BLOCK INC A (M) 322.0000 70.51000 22,704.22 14,589.62 8,114.60 N/A N/A <1% BA BOEING CO (M) 116.0000 229.03000 26,567.48 42,559.33 (15,991.85) N/A N/A <1% BMY BRISTOL MYERS SQUIBB CO (M) 90.0000 60.59000 5,453.10 5,076.90 376.20 4.15% 226.80 <1% SCHW CHARLES SCHWAB CORP (M) 230.0000 91.64000 21,077.20 5,273.41 15,803.79 1.39% 294.40 <1% " +
  "4 of 8 Statement Period April 1-30, 2026 Schwab One® Account of Positions - Equities (continued) Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct CHTR CHARTER COMMUNICATIONS I (M) 8.0000 165.17000 1,321.36 1,629.06 (307.70) N/A N/A <1% CSCO CISCO SYS INC (M) 845.0000 91.50000 77,317.50 24,714.90 52,602.60 1.83% 1,419.60 <1% C CITIGROUP INC (M) 124.0000 127.98000 15,869.52 2,229.78 13,639.74 1.87% 297.60 <1% GE GE AEROSPACE (M) 47.0000 289.93000 13,626.71 4,218.36 9,408.35 0.64% 88.36 <1% GEHC GE HEALTHCARE TECHNOLOGI (M) 9.0000 60.84000 547.56 801.55 (253.99) 0.23% 1.26 <1% GEV GE VERNOVA INC (M) 6.0000 1,083.4600 0 6,500.76 547.29 5,953.47 0.18% 12.00 <1% GILD GILEAD SCIENCES INC (M) 146.0000 130.84000 19,102.64 15,778.94 3,323.70 2.5% 478.88 <1% GS GOLDMAN SACHS GROUP INC (M) 63.0000 923.77000 58,197.51 9,987.13 48,210.38 1.94% 1,134.00 <1% LRCX LAM RESH CORP (M) 2,487.0000 257.86000 641,297.82 5,339.48 635,958.34 0.4% 2,586.48 8% MTSI MACOM TECHNOLOGY SOLUTIO (M) 20.0000 281.61000 5,632.20 3,357.57 2,274.63 N/A N/A <1% META META PLATFORMS INC (M) 614.0000 611.91000 375,712.74 105,668.49 270,044.25 0.34% 1,289.40 4% MSFT MICROSOFT CORP (M) 230.0000 407.78000 93,789.40 26,346.88 67,442.52 0.89% 837.20 2% NVDA NVIDIA CORP (M) 22,277.0000 199.57000 4,445,820.89 38,008.19 4,407,812.70 0.02% 891.08 38% QCOM QUALCOMM INC (M) 1,046.0000 179.58000 187,840.68 20,982.94 166,857.74 1.98% 3,723.76 3% RVTY REVVITY INC (M) 2,563.0000 86.62000 222,007.06 32,675.18 189,331.88 0.32% 717.64 4% RIVN RIVIAN AUTOMOTIVE INC (M) 558.0000 16.40000 9,151.20 64,619.19 (55,467.99) N/A N/A <1% CRM SALESFORCE INC (M) 88.0000 176.53000 15,534.64 19,665.36 (4,130.72) 0.99% 154.88 <1% SNDK SANDISK CORP (M) 25.0000 1,096.5100 0 27,412.75 672.38 26,740.37 N/A N/A <1% SWKS SKYWORKS SOLUTIONS INC (M) 41.0000 70.17000 2,876.97 2,185.90 i N/A i 4.04% 116.44 <1% TSLA TESLA INC (M) 2,760.0000 381.63000 1,053,298.80 105,235.55 948,063.25 N/A N/A 10% WBD WARNER BROS DISCOVERY IN (M) 36.0000 27.05000 973.80 2,085.20 (1,111.40) N/A N/A <1% WFC WELLS FARGO & CO (M) 202.0000 82.23000 16,610.46 3,171.38 13,439.08 2.18% 363.60 <1% WDC WESTERN DIGITAL CORP (M) 61.0000 434.52000 26,505.72 1,694.27 24,811.45 0.11% 30.50 <1% " +
  "5 of 8 Statement Period April 1-30, 2026 Schwab One® Account of Positions - Equities (continued) Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct ZM ZOOM COMMUNICATIONS INC (M) 12.0000 97.15000 1,165.80 4,922.04 (3,756.24) N/A N/A <1% Total Equities $8,942,700.19 $681,911.28 $8,260,097.84 $18,577.24 96% " +
  "Positions - Exchange Traded Funds Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct QQQ INVESCO QQQ TR (M), 345.0000 667.74000 230,370.30 N/A i N/A i 0.43% 1,011.30 2% SPY STATE STREET SPDR S&P (M), 30.0000 718.66000 21,559.80 6,172.69 15,387.11 1.0% 215.64 <1% Total Exchange Traded Funds $251,930.10 $6,172.69 $15,387.11 $1,226.94 3% " +
  "Transactions - Summary Beginning Cash* as of 04/01 + Deposits + Withdrawals + Purchases + Sales/Redemptions + Dividends/Interest + Expenses = Ending Cash* as of 04/30 $21,480.37 $0.00 $0.00 ($128.66) $0.00 $1,246.82 $0.00 $22,598.53";

const BROKERAGE_ROWS: Row[] = [
  ["GOOGL", "ALPHABET INC (M)", 1373, 384.8, 528330.4, 17581.28, 510749.12, 510749.12],
  ["GOOG", "ALPHABET INC (M)", 1324, 381.94, 505688.56, 16842.65, 488845.91, 488845.91],
  ["AMZN", "AMAZON.COM INC (M)", 1229, 265.06, 325758.74, 35589.12, 290169.62, 290169.62],
  ["AAPL", "APPLE INC (M)", 480, 271.35, 130248, 39308.16, 90939.84, 90939.84],
  ["T", "AT&T INC (M)", 44, 26.13, 1149.72, 2014.81, -865.09, -865.09],
  ["BAC", "BANK OF AMERICA CORP (M)", 982, 53.46, 52497.72, 5175.03, 47322.69, 47322.69],
  ["BIIB", "BIOGEN INC (M)", 27, 189.28, 5110.56, 1363.96, 3746.6, 3746.6],
  ["XYZ", "BLOCK INC A (M)", 322, 70.51, 22704.22, 14589.62, 8114.6, 8114.6],
  ["BA", "BOEING CO (M)", 116, 229.03, 26567.48, 42559.33, -15991.85, -15991.85],
  ["BMY", "BRISTOL MYERS SQUIBB CO (M)", 90, 60.59, 5453.1, 5076.9, 376.2, 376.2],
  ["SCHW", "CHARLES SCHWAB CORP (M)", 230, 91.64, 21077.2, 5273.41, 15803.79, 15803.79],
  ["CHTR", "CHARTER COMMUNICATIONS I (M)", 8, 165.17, 1321.36, 1629.06, -307.7, -307.7],
  ["CSCO", "CISCO SYS INC (M)", 845, 91.5, 77317.5, 24714.9, 52602.6, 52602.6],
  ["C", "CITIGROUP INC (M)", 124, 127.98, 15869.52, 2229.78, 13639.74, 13639.74],
  ["GE", "GE AEROSPACE (M)", 47, 289.93, 13626.71, 4218.36, 9408.35, 9408.35],
  ["GEHC", "GE HEALTHCARE TECHNOLOGI (M)", 9, 60.84, 547.56, 801.55, -253.99, -253.99],
  ["GEV", "GE VERNOVA INC (M)", 6, 1083.46, 6500.76, 547.29, 5953.47, 5953.47],
  ["GILD", "GILEAD SCIENCES INC (M)", 146, 130.84, 19102.64, 15778.94, 3323.7, 3323.7],
  ["GS", "GOLDMAN SACHS GROUP INC (M)", 63, 923.77, 58197.51, 9987.13, 48210.38, 48210.38],
  ["LRCX", "LAM RESH CORP (M)", 2487, 257.86, 641297.82, 5339.48, 635958.34, 635958.34],
  ["MTSI", "MACOM TECHNOLOGY SOLUTIO (M)", 20, 281.61, 5632.2, 3357.57, 2274.63, 2274.63],
  ["META", "META PLATFORMS INC (M)", 614, 611.91, 375712.74, 105668.49, 270044.25, 270044.25],
  ["MSFT", "MICROSOFT CORP (M)", 230, 407.78, 93789.4, 26346.88, 67442.52, 67442.52],
  ["NVDA", "NVIDIA CORP (M)", 22277, 199.57, 4445820.89, 38008.19, 4407812.7, 4407812.7],
  ["QCOM", "QUALCOMM INC (M)", 1046, 179.58, 187840.68, 20982.94, 166857.74, 166857.74],
  ["RVTY", "REVVITY INC (M)", 2563, 86.62, 222007.06, 32675.18, 189331.88, 189331.88],
  ["RIVN", "RIVIAN AUTOMOTIVE INC (M)", 558, 16.4, 9151.2, 64619.19, -55467.99, -55467.99],
  ["CRM", "SALESFORCE INC (M)", 88, 176.53, 15534.64, 19665.36, -4130.72, -4130.72],
  ["SNDK", "SANDISK CORP (M)", 25, 1096.51, 27412.75, 672.38, 26740.37, 26740.37],
  ["SWKS", "SKYWORKS SOLUTIONS INC (M)", 41, 70.17, 2876.97, 2185.9, null, -4.04],
  ["TSLA", "TESLA INC (M)", 2760, 381.63, 1053298.8, 105235.55, 948063.25, 948063.25],
  ["WBD", "WARNER BROS DISCOVERY IN (M)", 36, 27.05, 973.8, 2085.2, -1111.4, -1111.4],
  ["WFC", "WELLS FARGO & CO (M)", 202, 82.23, 16610.46, 3171.38, 13439.08, 13439.08],
  ["WDC", "WESTERN DIGITAL CORP (M)", 61, 434.52, 26505.72, 1694.27, 24811.45, 24811.45],
  ["ZM", "ZOOM COMMUNICATIONS INC (M)", 12, 97.15, 1165.8, 4922.04, -3756.24, -3756.24],
  ["QQQ", "INVESCO QQQ TR (M),", 345, 667.74, 230370.3, null, null, 0],
  ["SPY", "STATE STREET SPDR S&P (M),", 30, 718.66, 21559.8, 6172.69, 15387.11, 15387.11],
];

const BROKERAGE_ACCOUNT = {
  name: "Brokerage x5310",
  category: "taxable",
  subType: "brokerage",
  owner: "client",
  value: 9244543.44,
  basis: 688083.97,
  custodian: "Charles Schwab",
  statementDate: "2026-04-30",
  accountNumberLast4: "5310",
} as const;

/** What the model returned on 2026-10-21: every basis is the gain column. */
export const BROKERAGE_READ_2026_10_21 = {
  ...BROKERAGE_ACCOUNT,
  holdings: [
    { name: "Cash", ticker: "Cash", price: 1, shares: 22518.53, marketValue: 22518.53 },
    { name: "SCHWAB PRIME ADVANTAGE M,(M)", ticker: "SWVXX", price: 1, shares: 27314.62, costBasis: 27185.96, marketValue: 27314.62 },
    ...BROKERAGE_ROWS.map(([ticker, name, shares, price, marketValue, , , read]) => ({
      ticker, name, shares, price, marketValue, ...(read !== undefined ? { costBasis: read } : {}),
    })),
  ],
};

/** A faithful read of the same statement: each column where it belongs. */
export const BROKERAGE_CORRECT_READ = {
  ...BROKERAGE_ACCOUNT,
  holdings: [
    { name: "Cash", price: 1, shares: 22598.53, marketValue: 22598.53 },
    { name: "SCHWAB PRIME ADVANTAGE M,(M)", ticker: "SWVXX", price: 1, shares: 27314.62, marketValue: 27314.62 },
    ...BROKERAGE_ROWS.map(([ticker, name, shares, price, marketValue, costBasis, unrealizedGain]) => ({
      ticker, name, shares, price, marketValue,
      ...(costBasis !== null ? { costBasis } : {}),
      ...(unrealizedGain !== null ? { unrealizedGain } : {}),
    })),
  ],
};

export const IRA_TEXT =
  "3 of 8 Statement Period April 1-30, 2026 CHARLES SCHWAB & CO INC CUST IRA CONTRIBUTORY Contributory IRA of Positions - Summary Beginning Value as of 04/01 + Transfer of Securities(In/Out) + Dividends Reinvested + Cash Activity + Change in Market Value = Ending Value as of 04/30 Cost Basis Unrealized Gain/(Loss) $4,813,775.79 $0.00 ($297.10) $679.65 $656,041.42 $5,470,199.76 $1,165,469.41 i $3,263,558.15 i " +
  "Cash and Cash Investments Type Symbol Description Quantity Price($) Beginning Balance($) Ending Balance($) Change in Period Balance($) Pending/Unsettled Cash($) Interest/ Yield Rate % of Acct Bank Sweep CHARLES SCHWAB BANK,X,Z 41,862.05 45,534.59 3,672.54 0.01% 2% Money Fund (Non-Sweep) SWVXX SCHWAB PRIME ADVANTAGE M,◊ 63,518.4000 1.0000 63,221.30 63,518.40 297.10 2% Total Cash and Cash Investments $105,083.35 $109,052.99 $3,969.64 4% " +
  "Positions - Equities Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct ABBV ABBVIE INC 864.0000 211.32000 182,580.48 63,133.53 119,446.95 3.27% 5,978.88 2% AMD ADVANCED MICRO DEVIC 1,048.0000 354.49000 371,505.52 61,741.86 309,763.66 N/A N/A 6% AKAM AKAMAI TECHNOLOGIES INC 104.0000 102.98000 10,709.92 N/A i N/A i N/A N/A <1% GOOGL ALPHABET INC 204.0000 384.80000 78,499.20 3,354.88 75,144.32 0.21% 171.36 1% GOOG ALPHABET INC 108.0000 381.94000 41,249.52 1,765.80 39,483.72 0.21% 90.72 1% AMZN AMAZON.COM INC 264.0000 265.06000 69,975.84 20,059.06 49,916.78 N/A N/A 4% AAL AMERICAN AIRLS GROUP INC 144.0000 11.71000 1,686.24 N/A i N/A i N/A N/A <1% AMGN AMGEN INC 316.0000 346.25000 109,415.00 N/A i N/A i 2.91% 3,185.28 2% AAPL APPLE INC 1,778.0000 271.35000 482,460.30 11,061.68 471,398.62 0.38% 1,849.12 7% AVGO BROADCOM INC 79.0000 417.43000 32,976.97 N/A i N/A i 0.62% 205.40 <1% CVX CHEVRON CORP NEW 328.0000 193.31000 63,405.68 24,704.94 38,700.74 3.68% 2,335.36 <1% " +
  "4 of 8 Statement Period April 1-30, 2026 Contributory IRA of Positions - Equities (continued) Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct DELL DELL TECHNOLOGIES INC 256.0000 208.95000 53,491.20 N/A i N/A i 1.0% 537.60 2% DIS DISNEY WALT CO 449.0000 103.75000 46,583.75 N/A i N/A i 1.44% 673.50 1% ELV ELEVANCE HEALTH INC 159.0000 376.42000 59,850.78 37,404.07 22,446.71 1.82% 1,093.92 <1% FLS FLOWSERVE CORP 681.0000 73.64000 50,148.84 N/A i N/A i 1.19% 599.28 1% IBM IBM CORP 71.0000 230.98000 16,399.58 N/A i N/A i 2.9% 477.12 1% INTC INTEL CORP 1,403.0000 94.48000 132,555.44 N/A i N/A i N/A N/A 2% KD KYNDRYL HLDGS INC 53.0000 13.82000 732.46 N/A i N/A i N/A N/A <1% LMT LOCKHEED MARTIN CORP 145.0000 517.97000 75,105.65 53,869.96 21,235.69 2.66% 2,001.00 1% META META PLATFORMS INC 997.0000 611.91000 610,074.27 195,155.97 414,918.30 0.34% 2,093.70 8% MSFT MICROSOFT CORP 617.0000 407.78000 251,600.26 5,422.10 i N/A i 0.89% 2,245.88 5% NFLX NETFLIX INC 1,768.0000 93.61000 165,502.48 60,658.48 104,844.00 N/A N/A 3% NOC NORTHROP GRUMMAN CORP 72.0000 579.48000 41,722.56 26,184.88 15,537.68 1.59% 665.28 1% ORCL ORACLE CORP 755.0000 161.39000 121,849.45 N/A i N/A i 1.23% 1,510.00 2% PFE PFIZER INC 98.0000 26.70000 2,616.60 N/A i N/A i 6.44% 168.56 <1% RVTY REVVITY INC 1,232.0000 86.62000 106,715.84 N/A i N/A i 0.32% 344.96 2% RTX RTX CORP 2,054.0000 176.07000 361,647.78 149,949.92 211,697.86 1.54% 5,586.88 5% TSLA TESLA INC 548.0000 381.63000 209,133.24 24,362.38 184,770.86 N/A N/A 4% UNH UNITEDHEALTH GROUP INC 62.0000 370.48000 22,969.76 13,351.36 9,618.40 2.38% 548.08 <1% VTRS VIATRIS INC 4.0000 14.94000 59.76 N/A i N/A i 3.21% 1.92 <1% Total Equities $3,773,224.37 $752,180.87 $2,088,924.29 $32,363.80 65% " +
  "Positions - Exchange Traded Funds Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct FHLC FIDELITY MSCI HEALTH , 1,040.0000 70.40000 73,216.00 45,791.07 27,424.93 1.3% 952.64 2% SMH VANECK SEMICONDUCTOR , 1,401.0000 506.72000 709,914.72 80,509.73 629,404.99 N/A N/A 12% " +
  "5 of 8 Statement Period April 1-30, 2026 Contributory IRA of Positions - Exchange Traded Funds (continued) Symbol Description Quantity Price($) Market Value($) Cost Basis($) Unrealized Gain/(Loss)($) Est. Yield Est. Annual Income($) % of Acct VOX VANGUARD COMMUNICATION , 844.0000 196.84000 166,132.96 73,099.77 93,033.19 0.88% 1,471.60 2% VCR VANGUARD CONSUMER , 164.0000 393.58000 64,547.12 29,001.33 35,545.79 0.73% 471.80 4% VDE VANGUARD ENERGY INDEX , 411.0000 169.58000 69,697.38 37,038.54 32,658.84 2.28% 1,592.87 2% VFH VANGUARD FINANCIALS , 708.0000 128.20000 90,765.60 47,385.98 43,379.62 1.18% 1,074.18 3% VGT VANGUARD INFORMATION , 4,009.0000 103.18000 413,648.62 100,462.12 313,186.50 2.88% 11,927.58 6% Total Exchange Traded Funds $1,587,922.40 $413,288.54 $1,174,633.86 $17,490.67 31%";

/** [ticker, name, shares, price, marketValue, costBasis as read (undefined = omitted)] */
const IRA_ROWS: [string, string, number, number, number, number | undefined][] = [
  ["ABBV", "ABBVIE INC", 864, 211.32, 182580.48, 63133.53],
  ["AMD", "ADVANCED MICRO DEVIC", 1048, 354.49, 371505.52, 61741.86],
  ["AKAM", "AKAMAI TECHNOLOGIES INC", 104, 102.98, 10709.92, undefined],
  ["GOOGL", "ALPHABET INC", 204, 384.8, 78499.2, 3354.88],
  ["GOOG", "ALPHABET INC", 108, 381.94, 41249.52, 1765.8],
  ["AMZN", "AMAZON.COM INC", 264, 265.06, 69975.84, 20059.06],
  ["AAL", "AMERICAN AIRLS GROUP INC", 144, 11.71, 1686.24, undefined],
  ["AMGN", "AMGEN INC", 316, 346.25, 109415, 0],
  ["AAPL", "APPLE INC", 1778, 271.35, 482460.3, 11061.68],
  ["AVGO", "BROADCOM INC", 79, 417.43, 32976.97, undefined],
  ["CVX", "CHEVRON CORP NEW", 328, 193.31, 63405.68, 24704.94],
  ["DELL", "DELL TECHNOLOGIES INC", 256, 208.95, 53491.2, undefined],
  ["DIS", "DISNEY WALT CO", 449, 103.75, 46583.75, undefined],
  ["ELV", "ELEVANCE HEALTH INC", 159, 376.42, 59850.78, 37404.07],
  ["FLS", "FLOWSERVE CORP", 681, 73.64, 50148.84, undefined],
  ["IBM", "IBM CORP", 71, 230.98, 16399.58, undefined],
  ["INTC", "INTEL CORP", 1403, 94.48, 132555.44, undefined],
  ["KD", "KYNDRYL HLDGS INC", 53, 13.82, 732.46, undefined],
  ["LMT", "LOCKHEED MARTIN CORP", 145, 517.97, 75105.65, 53869.96],
  ["META", "META PLATFORMS INC", 997, 611.91, 610074.27, 195155.97],
  ["MSFT", "MICROSOFT CORP", 617, 407.78, 251600.26, 5422.1],
  ["NFLX", "NETFLIX INC", 1768, 93.61, 165502.48, 60658.48],
  ["NOC", "NORTHROP GRUMMAN CORP", 72, 579.48, 41722.56, 26184.88],
  ["ORCL", "ORACLE CORP", 755, 161.39, 121849.45, undefined],
  ["PFE", "PFIZER INC", 98, 26.7, 2616.6, undefined],
  ["RVTY", "REVVITY INC", 1232, 86.62, 106715.84, undefined],
  ["RTX", "RTX CORP", 2054, 176.07, 361647.78, 149949.92],
  ["SMH", "VANECK SEMICONDUCTOR", 1401, 506.72, 709914.72, 80509.73],
  ["TSLA", "TESLA INC", 548, 381.63, 209133.24, 24362.38],
  ["UNH", "UNITEDHEALTH GROUP INC", 62, 370.48, 22969.76, 13351.36],
  ["VGT", "VANGUARD INFORMATION", 4009, 103.18, 413648.62, 100462.12],
  ["VTRS", "VIATRIS INC", 4, 14.94, 59.76, undefined],
  ["FHLC", "FIDELITY MSCI HEALTH ,", 1040, 70.4, 73216, 45791.07],
  ["VOX", "VANGUARD COMMUNICATION ,", 844, 196.84, 166132.96, 73099.77],
  ["VCR", "VANGUARD CONSUMER ,", 164, 393.58, 64547.12, 29001.33],
  ["VDE", "VANGUARD ENERGY INDEX ,", 411, 169.58, 69697.38, 37038.54],
  ["VFH", "VANGUARD FINANCIALS ,", 708, 128.2, 90765.6, 47385.98],
];

/** What the model returned on 2026-10-21: basis right, cash quantity from the BEGINNING balance. */
export const IRA_READ_2026_10_21 = {
  name: "Contributory IRA x2867",
  category: "retirement",
  subType: "traditional_ira",
  owner: "client",
  value: 5470199.76,
  basis: 1165469.41,
  custodian: "Charles Schwab & Co",
  statementDate: "2026-04-30",
  accountNumberLast4: "2867",
  holdings: [
    { name: "Cash", ticker: "CHARLES SCHWAB BANK,X,Z", price: 1, shares: 41862.05, marketValue: 45534.59 },
    { name: "SCHWAB PRIME ADVANTAGE M,◊", ticker: "SWVXX", price: 1, shares: 63518.4, marketValue: 63518.4 },
    ...IRA_ROWS.map(([ticker, name, shares, price, marketValue, costBasis]) => ({
      ticker, name, shares, price, marketValue, ...(costBasis !== undefined ? { costBasis } : {}),
    })),
  ],
};
