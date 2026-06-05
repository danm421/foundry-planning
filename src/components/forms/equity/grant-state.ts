export interface GrantStateInput {
  grantType: "rsu" | "nqso" | "iso";
  currentYear: number;
  tranches: { vestYear: number; shares: number; sharesExercised: number; sharesSold: number }[];
}
export interface GrantStateSummary {
  granted: number; unvested: number; vestedHeld: number; exercisedHeld: number; sold: number;
}
export function summarizeGrant(g: GrantStateInput): GrantStateSummary {
  let granted = 0, unvested = 0, vestedHeld = 0, exercisedHeld = 0, sold = 0;
  for (const t of g.tranches) {
    granted += t.shares;
    sold += t.sharesSold;
    if (t.vestYear > g.currentYear) { unvested += t.shares; continue; }
    // vested tranche — partition its shares across the held/sold buckets:
    if (g.grantType === "rsu") {
      // RSUs have no exercise step: vested shares are held until sold.
      vestedHeld += Math.max(0, t.shares - t.sharesSold);
      // exercisedHeld stays 0 for RSUs.
    } else {
      // Options flow vested -> exercised -> sold (sold ⊆ exercised ⊆ vested).
      exercisedHeld += Math.max(0, t.sharesExercised - t.sharesSold);
      vestedHeld += Math.max(0, t.shares - t.sharesExercised);
    }
  }
  return { granted, unvested, vestedHeld, exercisedHeld, sold };
}
