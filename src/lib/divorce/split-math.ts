// Pure pro-rata split math for the divorce workbench. No DB/Next imports —
// shared by the UI, commit preview, and commit engine.

export interface SplitShare {
  value: number;
  basis: number;
  rothValue: number;
}

export interface SplitResult {
  primary: SplitShare;
  spouse: SplitShare;
}

const cents = (n: number) => Math.round(n * 100) / 100;

// Spouse share is round-to-cent of pct%; primary is the exact remainder —
// conservation (primary + spouse === original, to the cent) holds by construction.
export function splitAmounts(
  value: number,
  basis: number,
  rothValue: number,
  pctToSpouse: number,
): SplitResult {
  const p = pctToSpouse / 100;
  const spouse = { value: cents(value * p), basis: cents(basis * p), rothValue: cents(rothValue * p) };
  const primary = {
    value: cents(value - spouse.value),
    basis: cents(basis - spouse.basis),
    rothValue: cents(rothValue - spouse.rothValue),
  };
  return { primary, spouse };
}
