"use client";

import { Fragment } from "react";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { RecipientGroup } from "@/lib/gifts/build-recipient-drilldown";

interface OwnerAges {
  client: number;
  spouse?: number;
}

interface GiftCumulativeTableProps {
  ledger: GiftLedgerYear[];
  ownerNames: { clientName: string; spouseName: string | null };
  ownerAges: Record<number, OwnerAges>;
  expandedYears: Set<number>;
  onToggleYear: (year: number) => void;
  drilldownByYear: Map<number, RecipientGroup[]>;
}

const fmt = (n: number): string =>
  n === 0
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

export function GiftCumulativeTable({
  ledger,
  ownerNames,
  ownerAges,
  expandedYears,
  onToggleYear,
  drilldownByYear,
}: GiftCumulativeTableProps) {
  const hasSpouse = ownerNames.spouseName !== null;
  const colCount = hasSpouse ? 13 : 9;

  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b border-hair text-ink-3">
          <th className="text-left py-2 px-2">Year</th>
          <th className="text-left py-2 px-2">Age</th>
          <th className="text-right py-2 px-2">Gifts Given</th>
          <th className="text-right py-2 px-2">Taxable Gifts Given</th>
          <th className="text-right py-2 px-2">
            {ownerNames.clientName} Cumul. Gifts
          </th>
          <th className="text-right py-2 px-2">
            {ownerNames.clientName} Credit Used
          </th>
          <th className="text-right py-2 px-2">
            {ownerNames.clientName} Gift Tax
          </th>
          <th className="text-right py-2 px-2">
            {ownerNames.clientName} Cumul. Gift Tax
          </th>
          {hasSpouse && (
            <>
              <th className="text-right py-2 px-2">
                {ownerNames.spouseName} Cumul. Gifts
              </th>
              <th className="text-right py-2 px-2">
                {ownerNames.spouseName} Credit Used
              </th>
              <th className="text-right py-2 px-2">
                {ownerNames.spouseName} Gift Tax
              </th>
              <th className="text-right py-2 px-2">
                {ownerNames.spouseName} Cumul. Gift Tax
              </th>
            </>
          )}
          <th className="text-right py-2 px-2">Gift Tax</th>
        </tr>
      </thead>
      <tbody>
        {ledger.map((row) => {
          const ages = ownerAges[row.year];
          const ageStr =
            hasSpouse && ages?.spouse != null
              ? `${ages.client}/${ages.spouse}`
              : `${ages?.client ?? ""}`;
          const tinted = row.giftsGiven > 0;
          const expanded = expandedYears.has(row.year);
          const groups = drilldownByYear.get(row.year) ?? [];
          const c = row.perGrantor.client;
          const s = row.perGrantor.spouse;
          return (
            <Fragment key={row.year}>
              <tr
                data-testid={`gift-row-${row.year}`}
                className={`border-b border-hair cursor-pointer hover:bg-card-2 ${
                  tinted ? "bg-card-2/40" : ""
                }`}
                onClick={() => onToggleYear(row.year)}
              >
                <td className="py-1.5 px-2">{row.year}</td>
                <td className="py-1.5 px-2">{ageStr}</td>
                <td className="py-1.5 px-2 text-right">{fmt(row.giftsGiven)}</td>
                <td className="py-1.5 px-2 text-right">
                  {fmt(row.taxableGiftsGiven)}
                </td>
                <td className="py-1.5 px-2 text-right">
                  {fmt(c.cumulativeTaxableGifts)}
                </td>
                <td className="py-1.5 px-2 text-right">{fmt(c.creditUsed)}</td>
                <td
                  data-testid={`gift-tax-cell-${row.year}-client`}
                  className={`py-1.5 px-2 text-right ${
                    c.giftTaxThisYear > 0 ? "text-red-400" : ""
                  }`}
                >
                  {fmt(c.giftTaxThisYear)}
                </td>
                <td className="py-1.5 px-2 text-right">
                  {fmt(c.cumulativeGiftTax)}
                </td>
                {hasSpouse && (
                  <>
                    <td className="py-1.5 px-2 text-right">
                      {fmt(s?.cumulativeTaxableGifts ?? 0)}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {fmt(s?.creditUsed ?? 0)}
                    </td>
                    <td
                      data-testid={`gift-tax-cell-${row.year}-spouse`}
                      className={`py-1.5 px-2 text-right ${
                        (s?.giftTaxThisYear ?? 0) > 0 ? "text-red-400" : ""
                      }`}
                    >
                      {fmt(s?.giftTaxThisYear ?? 0)}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {fmt(s?.cumulativeGiftTax ?? 0)}
                    </td>
                  </>
                )}
                <td
                  className={`py-1.5 px-2 text-right ${
                    row.totalGiftTax > 0 ? "text-red-400" : ""
                  }`}
                >
                  {fmt(row.totalGiftTax)}
                </td>
              </tr>
              {groups.length > 0 && (
                <tr
                  data-drilldown-row
                  className={`${expanded ? "" : "hidden print:table-row"} bg-card-2/30 print:bg-transparent`}
                >
                  <td colSpan={colCount} className="px-4 py-3">
                    <DrilldownPanel year={row.year} groups={groups} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function DrilldownPanel({
  year,
  groups,
}: {
  year: number;
  groups: RecipientGroup[];
}) {
  return (
    <div className="space-y-4">
      <div className="text-ink-3">
        Gift Tax Event Ledger | Base Facts in {year}
      </div>
      {groups.map((g) => (
        <div key={g.label} className="drilldown-recipient">
          <div className="font-medium mb-1">Recipient: {g.label}</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-ink-3 border-b border-hair">
                <th className="text-left py-1 px-2">Description</th>
                <th className="text-right py-1 px-2">Amount</th>
                <th className="text-right py-1 px-2">Gift Value</th>
                <th className="text-right py-1 px-2">Exclusion</th>
                <th className="text-right py-1 px-2">Taxable Gift</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r, i) => (
                <tr key={i} className="border-b border-hair">
                  <td className="py-1 px-2">{r.description}</td>
                  <td className="py-1 px-2 text-right">{fmt(r.amount)}</td>
                  <td className="py-1 px-2 text-right">{fmt(r.giftValue)}</td>
                  <td className="py-1 px-2 text-right">{fmt(r.exclusion)}</td>
                  <td className="py-1 px-2 text-right">
                    {fmt(r.taxableGift)}
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1 px-2">Subtotal</td>
                <td className="py-1 px-2 text-right">
                  {fmt(g.subtotal.amount)}
                </td>
                <td className="py-1 px-2 text-right">
                  {fmt(g.subtotal.giftValue)}
                </td>
                <td className="py-1 px-2 text-right">
                  {fmt(g.subtotal.exclusion)}
                </td>
                <td className="py-1 px-2 text-right">
                  {fmt(g.subtotal.taxableGift)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
