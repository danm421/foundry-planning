import MoneyText from "@/components/money-text";
import type { StageTaxBreakdown } from "../lib/derive-spine-data";

export function TaxCalcWalk({
  breakdown,
  total,
}: {
  breakdown: StageTaxBreakdown;
  total: number;
}) {
  const lines: Array<{
    label: string;
    value: number;
    sign?: "neg";
    emphasis?: "computed" | "total";
  }> = [
    { label: "Gross estate", value: breakdown.grossEstate },
    { label: "Marital deduction", value: -breakdown.maritalDeduction, sign: "neg" },
    { label: "Charitable deduction", value: -breakdown.charitableDeduction, sign: "neg" },
    { label: "Admin expenses", value: -breakdown.estateAdminExpenses, sign: "neg" },
    { label: "Taxable estate", value: breakdown.taxableEstate, emphasis: "computed" },
    {
      label: "Applicable exclusion (BEA + DSUE)",
      value: -breakdown.applicableExclusion,
      sign: "neg",
    },
    { label: "Federal estate tax", value: breakdown.federalEstateTax },
    { label: "State estate tax", value: breakdown.stateEstateTax },
    { label: "Admin expenses (paid)", value: breakdown.estateAdminExpenses },
  ];
  return (
    <ul className="space-y-1 font-mono text-[12px]">
      {lines.map((l, i) => (
        <li
          key={i}
          className={`flex items-center justify-between ${
            l.emphasis === "computed" ? "border-t border-hair pt-1.5 mt-1.5 font-semibold" : ""
          }`}
        >
          <span
            className={`text-ink-2 ${
              l.emphasis === "computed" ? "uppercase tracking-wider text-[11px]" : ""
            }`}
          >
            {l.label}
          </span>
          <MoneyText
            value={l.value}
            className={`tabular-nums ${l.sign === "neg" ? "text-ink-3" : "text-ink"}`}
          />
        </li>
      ))}
      <li className="flex items-center justify-between border-t border-hair pt-1.5 mt-1.5 font-semibold">
        <span className="uppercase tracking-wider text-[11px] text-ink">Total</span>
        <MoneyText value={total} className="tabular-nums text-ink" />
      </li>
    </ul>
  );
}
