import { ROW, ageAtYearEnd, differs, makeDelta, money, n, ref } from "../compare";
import type { Check, Rule, Suggestion } from "../types";

export const assumptionRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];

  const carry = facts.carryovers.capitalLossCarryover;
  if (carry != null) {
    const p = n(plan.planSettings.capitalLossCarryforwardLt) + n(plan.planSettings.capitalLossCarryforwardSt);
    const fig = { returnFigure: { label: "Capital loss carried forward", amount: carry, display: money(carry), lineRefs: [ref("Sched D", "worksheet", "Capital loss carryover", carry)] }, planFigure: { label: "Plan carryforward (LT + ST)", amount: p, display: money(p), year: planYear } };
    if (Math.abs(carry - p) > 100) {
      suggestions.push({
        id: "carryover.capitalLoss", section: "household", kind: "update", status: "open",
        headline: `The return carries ${money(carry)} of capital losses forward; the plan starts with ${money(p)}.`,
        meaning: "The carryforward offsets future gains and $3,000 of ordinary income a year. The worksheet does not split short- from long-term, so the whole figure goes to long-term; adjust the split on Assumptions if you know it.",
        ...fig, delta: makeDelta(carry, p),
        action: { label: `Set carryforward to ${money(carry)}`, describe: `Sets the long-term capital loss carryforward to ${money(carry)}`, amountEditable: true, defaultAmount: carry, target: { kind: "plan_settings.update", patch: { capitalLossCarryforwardLt: carry }, amountField: "capitalLossCarryforwardLt" } },
      });
    } else checks.push({ id: "carryover.capitalLoss", label: "Capital loss carryforward", returnDisplay: money(carry), planDisplay: money(p) });
  }

  if (facts.income.agi != null) {
    const magi = facts.income.agi + n(facts.income.taxExemptInterest);
    const people: Array<{ owner: "client" | "spouse"; dob: string | null }> = [
      { owner: "client", dob: plan.client.dateOfBirth }, { owner: "spouse", dob: plan.client.spouseDob },
    ];
    for (const { owner, dob } of people) {
      const age = ageAtYearEnd(dob, taxYear);
      if (age == null || age < 63) continue;
      const row = plan.medicare.find((m) => m.owner === owner);
      const p = row?.priorYearMagi ?? null;
      const id = `medicare.priorYearMagi.${owner}`;
      const who = owner === "client" ? "the client" : "the spouse";
      const fig = { returnFigure: { label: "MAGI for Medicare", amount: magi, display: money(magi), lineRefs: [ref("1040", "11", "AGI", facts.income.agi), ref("1040", "2a", "Tax-exempt interest", facts.income.taxExemptInterest)] }, planFigure: { label: `Plan prior-year MAGI (${who})`, amount: p, display: money(p), year: planYear } };
      if (p == null || differs(magi, p, ROW)) {
        suggestions.push({
          id, section: "household", kind: "update", status: "open",
          headline: p == null ? `Medicare premiums for ${who} have no starting MAGI; the ${taxYear} return says ${money(magi)}.` : `The ${taxYear} return's MAGI is ${money(magi)}; the plan starts ${who}'s Medicare lookback at ${money(p)}.`,
          meaning: `Part B and Part D surcharges (IRMAA) look back two years, so the ${taxYear} return sets the ${taxYear + 2} premium. Until the plan has two projected years, this figure is what it uses.`,
          ...fig, delta: makeDelta(magi, p),
          action: { label: `Set MAGI to ${money(magi)}`, describe: `Sets ${who}'s prior-year MAGI for Medicare to ${money(magi)}`, amountEditable: true, defaultAmount: magi, target: { kind: "medicare.upsert", owner, priorYearMagi: magi, amountField: "priorYearMagi" } },
        });
      } else checks.push({ id, label: `Medicare MAGI (${who})`, returnDisplay: money(magi), planDisplay: money(p) });
    }
  }

  return { suggestions, checks };
};
