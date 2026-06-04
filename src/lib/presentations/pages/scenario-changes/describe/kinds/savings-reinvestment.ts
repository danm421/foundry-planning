import { addRow, removeRow, editRow, type DescribeContext } from "../generic";
import { nameFor } from "../format";
import { pct } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, type Describer } from "../registry";
import { DEFAULT_NAMES, isDefaultKey } from "@/lib/account-groups/resolver";

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

const scope = (p: Record<string, unknown>, ctx: DescribeContext): string => {
  const groups = Array.isArray(p.groupKeys) ? (p.groupKeys as string[]) : [];
  if (groups.length) {
    return (
      groups
        .map((g) => (isDefaultKey(g) ? DEFAULT_NAMES[g] : "Custom group"))
        .join(" + ") +
      " group" +
      (groups.length > 1 ? "s" : "")
    );
  }
  const ids = Array.isArray(p.accountIds) ? (p.accountIds as string[]) : [];
  return ids.length ? ids.map((id) => ctx.resolve.accountName(id)).join(", ") : "selected accounts";
};

const reinvestment: Describer = (c, ctx) => {
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const name = nameFor(c, ctx.targetNames) ?? `Reinvestment ${p.year ?? ""}`.trim();
  if (c.opType === "edit") return editRow(c, { ...SPEC.reinvestment }, name);
  if (c.opType === "remove") return removeRow("Savings", name, ["No longer in this plan"]);

  const ids = Array.isArray(p.accountIds) ? (p.accountIds as string[]) : [];
  // Prior allocation: summarize the first affected account's base mix (representative).
  const prior = ids.map((id) => ctx.resolve.baseAllocation(id)).find(Boolean);
  const priorLine = prior ? `Were: ~${prior.mix}, ${pct(prior.blendedRate)}/yr` : null;

  const model = ctx.resolve.modelPortfolio(p.modelPortfolioId as string);
  const newRate = num(p.customGrowthRate); // CORRECTED: customGrowthRate (string-coerced), not newGrowthRate
  const newLine = model
    ? `New model: ${model.name} (${pct(model.rate)}/yr)`
    : newRate != null
      ? `New growth ${pct(newRate)}/yr (custom mix)`
      : null;

  const taxes = p.realizeTaxesOnSwitch ? "Taxes realized on switch" : "Tax-deferred switch";

  return addRow("Savings", name, [
    `Year ${p.year ?? "—"} · ${scope(p, ctx)}`,
    priorLine,
    newLine,
    taxes,
  ].filter((l): l is string => !!l));
};

DESCRIBERS.reinvestment = reinvestment;
