import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
import { money, yearWithRef, joinSegments, toNum } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

const rothConversion: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Roth conversion";
  if (c.opType === "edit") return editRow(c, { ...SPEC.roth_conversion }, name);
  if (c.opType === "remove") return removeRow("Taxes", name, ["No longer in this plan"]);
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const srcIds = Array.isArray(p.sourceAccountIds) ? (p.sourceAccountIds as string[]) : [];
  const sources = srcIds.length
    ? srcIds.map((id) => ctx.resolve.accountName(id)).join(", ")
    : "source accounts";
  const dest = ctx.resolve.accountName(p.destinationAccountId as string);
  const start = toNum(p.startYear);
  const end = toNum(p.endYear);
  const window = end != null
    ? `${yearWithRef(start, p.startYearRef as string)}–${end}`
    : yearWithRef(start, p.startYearRef as string);
  let amount: string;
  switch (p.conversionType) {
    case "full_account":
      amount = `Convert full ${sources}`;
      break;
    case "deplete_over_period":
      amount = `Deplete ${sources}`;
      break;
    case "fill_up_bracket":
      amount = `Fill ${Math.round((toNum(p.fillUpBracket) ?? 0) * 100)}% bracket from ${sources}`;
      break;
    default:
      amount = `${money(p.fixedAmount)}/yr from ${sources}`;
  }
  return addRow("Taxes", name, [joinSegments([`${amount} → ${dest}`, window])]);
};

const clientDeduction = simpleDescriber({
  area: "Taxes",
  noun: "deduction",
  whatMode: "name",
  segments: [(p) => (p.amount != null ? money(p.amount) : null)],
});

DESCRIBERS.roth_conversion = rothConversion;
DESCRIBERS.client_deduction = clientDeduction;
