import { describe, it, expect } from "vitest";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { emptyBusiness } from "@/lib/schemas/tax-return-facts";
import { buildFindings } from "../findings";
import {
  findingCtx, retireeMfj, highEarnerMfj, landlordSingle, singleNearIrmaa,
  scheduleCOwnerSingle, sCorpOwnerMfj,
} from "./fixtures";

/** Hard-coded, NOT imported from findings/index.ts. A test parameterized over
 *  the constant it is guarding cannot notice a builder that was removed. */
const EXPECTED_IDS = [
  "bracket-position", "roth-headroom", "ltcg-zero-headroom", "qcd", "irmaa-cliff",
  "charitable-bunching", "niit-exposure", "additional-medicare", "safe-harbor",
  "ctc-phaseout", "education-credits", "capital-loss-carryover", "state-notes",
  "se-retirement-plan-gap", "qbi-phaseout-position", "s-corp-election",
  "rental-cash-vs-paper", "suspended-passive-loss", "guaranteed-payments-se-tax",
  "business-loss-mix", "se-health-insurance", "reasonable-compensation",
] as const;

const mutate = (base: TaxReturnFacts, f: (x: TaxReturnFacts) => void): TaxReturnFacts => {
  f(base);
  return base;
};

const CORPUS: Array<{ name: string; facts: TaxReturnFacts; primaryAge: number | null; spouseAge: number | null }> = [
  { name: "retiree MFJ", facts: retireeMfj(), primaryAge: 72, spouseAge: 72 },
  { name: "high earner MFJ", facts: highEarnerMfj(), primaryAge: 45, spouseAge: 45 },
  { name: "landlord single", facts: landlordSingle(), primaryAge: 41, spouseAge: null },
  { name: "single near IRMAA", facts: singleNearIrmaa(), primaryAge: 72, spouseAge: null },
  {
    name: "retiree with 0% cap-gains room",
    facts: mutate(retireeMfj(), (f) => {
      f.deductions.taxableIncome = 60000;
      f.income.netLongTermGain = 10000;
      f.income.qualifiedDividends = 0;
    }),
    primaryAge: 72, spouseAge: 72,
  },
  {
    name: "high earner with a college-age dependent",
    facts: mutate(highEarnerMfj(), (f) => { f.dependents17to23 = 1; }),
    primaryAge: 45, spouseAge: 45,
  },
  {
    name: "retiree with a capital-loss carryover",
    facts: mutate(retireeMfj(), (f) => { f.carryovers.capitalLossCarryover = 18000; }),
    primaryAge: 72, spouseAge: 72,
  },
  {
    name: "landlord in a no-income-tax state",
    facts: mutate(landlordSingle(), (f) => { f.residenceState = "TX"; }),
    primaryAge: 41, spouseAge: null,
  },
  { name: "Schedule C owner single", facts: scheduleCOwnerSingle(), primaryAge: 44, spouseAge: null },
  { name: "S-corp owner MFJ", facts: sCorpOwnerMfj(), primaryAge: 51, spouseAge: 49 },
  {
    name: "Schedule C owner with a second, losing business",
    facts: mutate(scheduleCOwnerSingle(), (f) => {
      f.businesses.push({ ...emptyBusiness(), name: "Birch Studio", netProfit: -18000 });
    }),
    primaryAge: 44, spouseAge: null,
  },
  {
    name: "landlord with a suspended passive loss",
    facts: mutate(landlordSingle(), (f) => { f.income.scheduleE!.suspendedPassiveLoss = 12400; }),
    primaryAge: 41, spouseAge: null,
  },
  {
    // Reaches ctcPhaseout's NEAR-threshold arm (400k − 370k < the 50k window),
    // which no other persona can: the other MFJ returns sit above the threshold.
    name: "MFJ approaching the child-tax-credit threshold",
    facts: mutate(highEarnerMfj(), (f) => { f.income.agi = 370000; }),
    primaryAge: 45, spouseAge: 45,
  },
  {
    // Reaches educationCredits' PARTIAL arm — inside the 160k–180k window
    // rather than above it, which is the only arm the corpus had.
    name: "MFJ inside the education-credit phase-out window",
    facts: mutate(highEarnerMfj(), (f) => { f.income.agi = 170000; f.dependents17to23 = 1; }),
    primaryAge: 45, spouseAge: 45,
  },
];

describe("finding completeness", () => {
  it.each(CORPUS)("$name — every finding that fires carries four non-empty parts", (persona) => {
    const findings = buildFindings(
      findingCtx(persona.facts, { primaryAge: persona.primaryAge, spouseAge: persona.spouseAge }),
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.headline.trim(), `${f.id} headline`).not.toBe("");
      expect(f.whatTheReturnShows.trim(), `${f.id} whatTheReturnShows`).not.toBe("");
      expect(f.whyItMatters.trim(), `${f.id} whyItMatters`).not.toBe("");
      expect(f.whatToConsider.trim(), `${f.id} whatToConsider`).not.toBe("");
      // A finding that claims a dollar figure must claim a real one.
      if (f.estimatedImpact !== null) expect(Number.isFinite(f.estimatedImpact)).toBe(true);
      // Every cited amount is read from facts, so it is a number or an
      // explicit "the return doesn't carry it" — never NaN or undefined.
      for (const r of f.lineRefs) {
        expect(r.form.trim(), `${f.id} lineRef form`).not.toBe("");
        expect(r.line.trim(), `${f.id} lineRef line`).not.toBe("");
        expect(r.amount === null || Number.isFinite(r.amount), `${f.id} lineRef amount`).toBe(true);
      }
    }
  });

  it("fires every catalogued finding at least once across the corpus", () => {
    const fired = new Set(
      CORPUS.flatMap((p) =>
        buildFindings(findingCtx(p.facts, { primaryAge: p.primaryAge, spouseAge: p.spouseAge })),
      ).map((f) => f.id),
    );
    expect(EXPECTED_IDS.filter((id) => !fired.has(id))).toEqual([]);
  });
});
