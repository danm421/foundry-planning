import type { ClientInfo } from "@/engine/types";
import type { LtcCoverage } from "@/engine/ltc-event";
import { exactCurrency } from "@/lib/presentations/format";
import { ltcPersonFirstName } from "./ltc-event-name";

const aboutDollars = (n: number) => exactCurrency(Math.round(n / 1000) * 1000);

/** The Stress row's coverage line, one sentence per entry. Every figure is the
 *  payout walk's own result (`applyLtcEvent(...).resolution.coverage`), never
 *  re-derived from the policy fields: a second derivation is how a screen and
 *  its engine drift apart. The percentage covers the whole care period (Dan,
 *  2026-10-08). */
export function ltcCoverageLines(coverage: LtcCoverage, client: ClientInfo): string[] {
  if (!coverage.includePolicies) {
    return ["LTC policies are left out of this test. The household pays the full cost."];
  }
  const named = coverage.people.length > 1;
  const lines: string[] = [];
  for (const p of coverage.people) {
    const who = ltcPersonFirstName(p.person, client);
    if (p.policies.length === 0) {
      lines.push(
        named
          ? `No LTC coverage on file for ${who}. The household pays the full cost of their care.`
          : "No LTC coverage on file. The household pays the full cost.",
      );
      continue;
    }
    let led = false;
    for (const b of p.policies) {
      if (b.firstYear == null) {
        lines.push(`${b.name} isn't in force during this care, so it pays nothing.`);
        continue;
      }
      lines.push(`${led ? "" : "Covered: "}${b.name} pays up to ${exactCurrency(Math.round(b.monthlyLimit))}/mo in ${b.firstYear}.`);
      led = true;
    }
    if (p.policies.some((b) => b.kind === "standalone") && p.policies.some((b) => b.kind === "life_rider")) {
      lines.push("Traditional policies pay first, so the rider uses as little of the death benefit as it can.");
    }
    const span = p.startYear === p.endYear ? `${p.startYear}` : `${p.startYear}–${p.endYear}`;
    const pct = p.totalCost > 0 ? Math.round((p.totalCovered / p.totalCost) * 100) : 0;
    const payer = p.policies.length === 1 ? "the policy pays" : "the policies pay";
    lines.push(
      `Over ${named ? `${who}'s care` : "care"} (${span}) ${payer} about ${aboutDollars(p.totalCovered)} of the ${aboutDollars(p.totalCost)} cost (${pct}%).`,
    );
  }
  return lines;
}
