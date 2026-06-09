// Sell-to-cover withholding math — the single source of truth shared by the
// cash-flow engine (tax-events.ts) and the Future Activity report.
// Pure, framework-free.

const ROUND = (n: number) => Math.round(n * 1e6) / 1e6;

export interface SellToCoverInput {
  taxableIncome: number;   // RSU income (shares × FMV-or-83b) or NQSO spread
  fmvAtYear: number;       // projected FMV in the action year (divisor + sale price)
  shares: number;          // shares acquired (vested / exercised)
  sellToCover: boolean;
  withholdingRate: number; // 0..1
}

export interface SellToCoverResult {
  coverShares: number;     // 0 when disabled / rate 0 / income 0 / fmv 0
  proceeds: number;        // coverShares × fmvAtYear
  retained: number;        // shares − coverShares
}

export function computeSellToCover(input: SellToCoverInput): SellToCoverResult {
  const { taxableIncome, fmvAtYear, shares, sellToCover, withholdingRate } = input;
  if (!sellToCover || withholdingRate <= 0 || taxableIncome <= 0 || fmvAtYear <= 0) {
    return { coverShares: 0, proceeds: 0, retained: shares };
  }
  const coverShares = Math.min(shares, ROUND((taxableIncome * withholdingRate) / fmvAtYear));
  if (coverShares <= 0) return { coverShares: 0, proceeds: 0, retained: shares };
  return {
    coverShares,
    proceeds: ROUND(coverShares * fmvAtYear),
    retained: ROUND(shares - coverShares),
  };
}
