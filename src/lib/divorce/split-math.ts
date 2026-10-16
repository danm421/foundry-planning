// Pure pro-rata split math for the divorce workbench. No DB/Next imports —
// shared by the UI, commit preview, and commit engine.

export interface SplitShare {
  value: number;
  basis: number;
  rothValue: number;
  marginBalance: number;
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
  marginBalance = 0,
): SplitResult {
  const p = pctToSpouse / 100;
  const spouse = { value: cents(value * p), basis: cents(basis * p), rothValue: cents(rothValue * p), marginBalance: cents(marginBalance * p) };
  const primary = {
    value: cents(value - spouse.value),
    basis: cents(basis - spouse.basis),
    rothValue: cents(rothValue - spouse.rothValue),
    marginBalance: cents(marginBalance - spouse.marginBalance),
  };
  return { primary, spouse };
}
