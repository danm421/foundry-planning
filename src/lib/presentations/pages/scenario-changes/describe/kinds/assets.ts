import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
import { money, yearWithRef, joinSegments, label } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

const num = (v: unknown) => (typeof v === "string" ? Number(v) : (v as number));

const timing = (p: Record<string, unknown>): string | null => {
  const start = num(p.startYear);
  if (!Number.isFinite(start)) return null;
  const startStr = yearWithRef(start, p.startYearRef as string);
  if (p.mode === "recurring" && Number.isFinite(num(p.endYear)))
    return `${startStr} → ${yearWithRef(num(p.endYear), p.endYearRef as string)}`;
  return startStr;
};

const transfer: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Transfer";
  if (c.opType === "edit") return editRow(c, { ...SPEC.transfer }, name);
  if (c.opType === "remove") return removeRow("Assets", name, ["No longer in this plan"]);
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const line = joinSegments([
    money(p.amount),
    `from ${ctx.resolve.accountName(p.sourceAccountId as string)} → ${ctx.resolve.accountName(p.targetAccountId as string)}`,
    label("transferMode", p.mode),
    timing(p),
  ]);
  return addRow("Assets", name, [line]);
};

const account = simpleDescriber({
  area: "Assets", noun: "account", whatMode: "name",
  segments: [
    (p) => label("accountCategory", p.category),
    (p) => (p.value != null ? money(p.value) : null),
  ],
});

const transferSchedule = simpleDescriber({
  area: "Assets", noun: "transfer schedule", whatMode: "name",
  segments: [() => "Custom per-year transfer amounts"],
});

DESCRIBERS.transfer = transfer;
DESCRIBERS.account = account;
DESCRIBERS.transfer_schedule = transferSchedule;
