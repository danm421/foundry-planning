import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
import { money, yearWithRef, joinSegments, label, toNum } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

const timing = (p: Record<string, unknown>): string | null => {
  const start = toNum(p.startYear);
  if (start == null) return null;
  const startStr = yearWithRef(start, p.startYearRef as string);
  const end = toNum(p.endYear);
  if (p.mode === "recurring" && end != null)
    return `${startStr} → ${yearWithRef(end, p.endYearRef as string)}`;
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

const assetTransaction: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames);
  if (c.opType === "edit") return editRow(c, { ...SPEC.asset_transaction }, name ?? "Asset transaction");
  if (c.opType === "remove") return removeRow("Assets", name ?? "Asset transaction", ["No longer in this plan"]);
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const yr = yearWithRef(toNum(p.year), null);
  // Projection-derived figures (actual value bought/sold + net cash received),
  // keyed by transaction id. Absent for transactions outside the projection
  // window or when the engine skipped the sale — fall back to payload values.
  const computed = ctx.resolve.assetTx(c.targetId);
  if (p.type === "buy") {
    const buy = computed?.type === "buy" ? computed : null;
    const hasComputedBuy = (buy?.purchasePrice ?? 0) > 0;
    const price = hasComputedBuy ? buy?.purchasePrice : toNum(p.purchasePrice);
    const mortgageAmt = buy ? buy.mortgageAmount : toNum(p.mortgageAmount);
    const mortgageRate = toNum(p.mortgageRate);
    const line = joinSegments([
      `Buy ${p.assetName ?? name ?? "asset"}`,
      price != null ? `for ${money(price)}` : null,
      yr,
      p.fundingAccountId ? `funded from ${ctx.resolve.accountName(p.fundingAccountId as string)}` : null,
      mortgageAmt ? `${money(mortgageAmt)} mortgage${mortgageRate ? ` @ ${(mortgageRate * 100).toFixed(1)}%` : ""}` : null,
    ]);
    return addRow("Assets", name ?? `Buy ${p.assetName ?? "asset"}`, [line]);
  }
  // sell
  const soldLabel = p.accountId ? ctx.resolve.accountName(p.accountId as string) : (name ?? "holding");
  const fractionSold = toNum(p.fractionSold);
  // Prefer the projected sale value; fall back to a manual override. A skipped
  // sale yields 0 — treat that as "no computed value" (don't print "$0 sale" /
  // "$0 net") and fall back to the override. One boolean drives both lines.
  const sell = computed?.type === "sell" ? computed : null;
  const hasComputedSale = (sell?.saleValue ?? 0) > 0;
  const saleValue = hasComputedSale ? sell?.saleValue : toNum(p.overrideSaleValue);
  const netProceeds = hasComputedSale ? sell?.netProceeds : null;
  const line = joinSegments([
    `Sell ${soldLabel}`,
    yr,
    saleValue != null ? `${money(saleValue)} sale` : null,
    netProceeds != null ? `${money(netProceeds)} net` : null,
    p.proceedsAccountId ? `proceeds → ${ctx.resolve.accountName(p.proceedsAccountId as string)}` : null,
    p.qualifiesForHomeSaleExclusion ? "home-sale exclusion applied" : null,
    fractionSold && fractionSold < 1 ? `${Math.round(fractionSold * 100)}% partial` : null,
  ]);
  return addRow("Assets", name ?? "Asset sale", [line]);
};

DESCRIBERS.transfer = transfer;
DESCRIBERS.account = account;
DESCRIBERS.transfer_schedule = transferSchedule;
DESCRIBERS.asset_transaction = assetTransaction;
