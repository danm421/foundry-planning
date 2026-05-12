import type { Bracket, BracketLine } from "@/lib/tax/state-estate/types";
import { deriveInheritanceClass } from "./classify";
import { STATE_INHERITANCE_TAX } from "./data";
import { computeExclusions } from "./special-rules";
import type {
  ComputeStateInheritanceTaxInput,
  InheritanceRecipientResult,
  StateInheritanceTaxResult,
} from "./types";

const EMPTY: StateInheritanceTaxResult = {
  state: null,
  inactive: true,
  estateMinimumFloorApplied: false,
  perRecipient: [],
  totalTax: 0,
  notes: [],
};

export function computeStateInheritanceTax(
  input: ComputeStateInheritanceTaxInput,
): StateInheritanceTaxResult {
  if (input.state == null) return EMPTY;
  const rule = STATE_INHERITANCE_TAX[input.state];
  const notes: string[] = [`Citation: ${rule.citation}`];

  if (rule.estateMinimum != null && input.grossEstate < rule.estateMinimum) {
    return {
      state: input.state,
      inactive: false,
      estateMinimumFloorApplied: true,
      perRecipient: input.recipients.map((r) => ({
        recipientKey: r.key,
        label: r.label,
        classLabel: "—",
        classSource: "derived-from-relationship",
        grossShare: r.grossShare,
        excluded: 0,
        excludedReasons: [],
        exemption: 0,
        taxableShare: 0,
        bracketLines: [],
        tax: 0,
        netToRecipient: r.grossShare,
        notes: [],
      })),
      totalTax: 0,
      notes: [
        ...notes,
        `Gross estate below $${rule.estateMinimum.toLocaleString()} — no MD inheritance tax (MD Tax-Gen. §7-204(b)).`,
      ],
    };
  }

  const perRecipient: InheritanceRecipientResult[] = [];
  for (const r of input.recipients) {
    const derived = deriveInheritanceClass(input.state, r);
    const recipNotes: string[] = [];

    // Exempt classes (Class A in most states; NE spouse) → zero tax, no bracket walk
    if (derived.classLabel === "exempt" || derived.classLabel === "A") {
      perRecipient.push({
        recipientKey: r.key,
        label: r.label,
        classLabel: derived.classLabel,
        classSource: derived.classSource,
        grossShare: r.grossShare,
        excluded: 0,
        excludedReasons: [],
        exemption: 0,
        taxableShare: 0,
        bracketLines: [],
        tax: 0,
        netToRecipient: r.grossShare,
        notes: recipNotes,
      });
      continue;
    }

    const classRule = rule.classes[derived.classLabel];
    if (!classRule) {
      throw new Error(`No class rule for ${input.state} class ${derived.classLabel}`);
    }

    if (classRule.deMinimis != null && r.grossShare < classRule.deMinimis) {
      perRecipient.push({
        recipientKey: r.key,
        label: r.label,
        classLabel: derived.classLabel,
        classSource: derived.classSource,
        grossShare: r.grossShare,
        excluded: 0,
        excludedReasons: [],
        exemption: classRule.exemption,
        taxableShare: 0,
        bracketLines: [],
        tax: 0,
        netToRecipient: r.grossShare,
        notes: [`Bequest under $${classRule.deMinimis} de minimis threshold — no tax (NJSA 54:34-2(a)(1)).`],
      });
      continue;
    }

    const exclusions = computeExclusions(rule, r, input.decedentAge);
    const excluded = exclusions.reduce((s, e) => s + e.amount, 0);
    const excludedReasons = exclusions.map((e) => e.reason);
    const adjustedShare = Math.max(0, r.grossShare - excluded);
    const exemption = classRule.exemption;
    const taxableShare = Math.max(0, adjustedShare - exemption);
    const bracketLines = applyBrackets(classRule.brackets, taxableShare);
    const tax = bracketLines.reduce((s, l) => s + l.tax, 0);

    perRecipient.push({
      recipientKey: r.key,
      label: r.label,
      classLabel: derived.classLabel,
      classSource: derived.classSource,
      grossShare: r.grossShare,
      excluded,
      excludedReasons,
      exemption,
      taxableShare,
      bracketLines,
      tax,
      netToRecipient: r.grossShare - tax,
      notes: recipNotes,
    });
  }

  const totalTax = perRecipient.reduce((s, p) => s + p.tax, 0);

  return {
    state: input.state,
    inactive: false,
    estateMinimumFloorApplied: false,
    perRecipient,
    totalTax: round2(totalTax),
    notes,
  };
}

export function applyBrackets(brackets: Bracket[], baseForTax: number): BracketLine[] {
  const lines: BracketLine[] = [];
  for (const b of brackets) {
    if (baseForTax <= b.from) break;
    const upper = b.to ?? baseForTax;
    const top = Math.min(baseForTax, upper);
    const amountTaxed = Math.max(0, top - b.from);
    if (amountTaxed <= 0) continue;
    lines.push({
      from: b.from,
      to: upper,
      rate: b.rate,
      amountTaxed,
      tax: round2(amountTaxed * b.rate),
    });
  }
  return lines;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
