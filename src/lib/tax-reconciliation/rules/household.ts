import { ageAtYearEnd, detailsHref, ref } from "../compare";
import type { Check, Rule, Suggestion } from "../types";

const FILING_LABEL: Record<string, string> = {
  single: "Single", married_joint: "Married filing jointly", married_separate: "Married filing separately", head_of_household: "Head of household",
};

export const householdRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];

  if (facts.filingStatus) {
    const r = FILING_LABEL[facts.filingStatus], p = FILING_LABEL[plan.client.filingStatus];
    const fig = { returnFigure: { label: "Filing status", amount: null, display: r, lineRefs: [ref("1040", "Filing status", "Filing status", null)] }, planFigure: { label: "Plan filing status", amount: null, display: p, year: planYear } };
    if (facts.filingStatus !== plan.client.filingStatus) {
      suggestions.push({
        id: "household.filingStatus", section: "household", kind: "update", status: "open",
        headline: `The ${taxYear} return was filed ${r.toLowerCase()}; the plan models ${p.toLowerCase()}.`,
        meaning: "Filing status sets the brackets, the standard deduction and every phase-out the plan applies. The return is the fact; change the plan unless the household's situation has changed since filing.",
        ...fig, delta: { amount: null, display: "Differs", tone: "neutral" },
        action: { label: `Set filing status to ${r}`, describe: `Sets the household's filing status to ${r}`, amountEditable: false, defaultAmount: null, target: { kind: "client.update", patch: { filingStatus: facts.filingStatus } } },
      });
    } else checks.push({ id: "household.filingStatus", label: "Filing status", returnDisplay: r, planDisplay: p });
  }

  if (facts.residenceState) {
    const p = plan.planSettings.residenceState;
    const fig = { returnFigure: { label: "State on the return", amount: null, display: facts.residenceState, lineRefs: [ref("1040", "Address", "Residence state", null)] }, planFigure: { label: "Plan residence state", amount: null, display: p ?? "Not set", year: planYear } };
    if (p !== facts.residenceState) {
      suggestions.push({
        id: "household.residenceState", section: "household", kind: "update", status: "open",
        headline: p ? `The return was filed from ${facts.residenceState}; the plan taxes the household in ${p}.` : `The return was filed from ${facts.residenceState}; the plan has no residence state.`,
        meaning: "State income and estate tax in the plan follow this setting. Without it the plan charges no state income tax at all.",
        ...fig, delta: { amount: null, display: p ? "Differs" : "Not set", tone: p ? "neutral" : "missing" },
        action: { label: `Set residence state to ${facts.residenceState}`, describe: `Sets the plan's residence state to ${facts.residenceState}`, amountEditable: false, defaultAmount: null, target: { kind: "plan_settings.update", patch: { residenceState: facts.residenceState } } },
      });
    } else checks.push({ id: "household.residenceState", label: "Residence state", returnDisplay: facts.residenceState, planDisplay: p });
  }

  if (facts.dependentsUnder17 != null || facts.dependents17to23 != null) {
    const r = (facts.dependentsUnder17 ?? 0) + (facts.dependents17to23 ?? 0);
    const p = plan.familyMembers.filter((m) => {
      if (m.role !== "child" || !["child", "stepchild"].includes(m.relationship) || m.claimedAsDependent === "no") return false;
      const age = ageAtYearEnd(m.dateOfBirth, taxYear);
      return age != null && age <= 23;
    }).length;
    const fig = { returnFigure: { label: "Dependents claimed", amount: r, display: String(r), lineRefs: [ref("1040", "Dependents", "Dependents", r)] }, planFigure: { label: "Children the plan would claim", amount: p, display: String(p), year: taxYear } };
    if (r !== p) {
      suggestions.push({
        id: "household.dependents", section: "household", kind: "review", status: "open",
        headline: `The return claims ${r} dependent${r === 1 ? "" : "s"}; the plan's household would claim ${p}.`,
        meaning: "The child tax credit, the dependent care credit and education credits all key off who is claimed. Add the missing children on Profile, or mark a child as not claimed.",
        // A headcount, not money: keep the signed difference but never render it with fmtUsd.
        ...fig, delta: { amount: p - r, display: "Differs", tone: "neutral" },
        link: { label: "Open Profile", href: detailsHref(input, "family") },
      });
    } else checks.push({ id: "household.dependents", label: "Dependents", returnDisplay: String(r), planDisplay: String(p) });
  }

  return { suggestions, checks };
};
