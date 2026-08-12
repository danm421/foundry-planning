import MoneyText from "@/components/money-text";
import type { StressWindow } from "@/lib/investments/proposals/types";
import { SectionCard, SectionHeading, SectionNote } from "./proposal-section";

const STRESS_TOOLTIP =
  "What each portfolio's current holdings would have returned through three historical shocks, using the months both portfolios share. A window counts only when every holding covers all of it — partial coverage understates the loss, so it is reported as unavailable instead.";

/** Month labels read better than the raw `YYYY-MM` the snapshot stores. */
const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  timeZone: "UTC",
});

function monthLabel(ym: string): string {
  return MONTH_FMT.format(new Date(`${ym}-01T00:00:00.000Z`));
}

function ReturnCell({ pct, dollars }: { pct: number | null; dollars: number | null }) {
  return (
    <td className="py-2 text-right">
      <span className={`block text-[13px] ${pct != null && pct < 0 ? "text-crit" : "text-ink"}`}>
        <MoneyText value={pct} format="pct" />
      </span>
      <span className="block text-[11px] text-ink-3">
        <MoneyText value={dollars} format="accounting" />
      </span>
    </td>
  );
}

export function ProposalStressSection({ stress }: { stress: StressWindow[] }) {
  return (
    <SectionCard>
      <SectionHeading tooltip={STRESS_TOOLTIP}>Stress test</SectionHeading>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-hair-2">
              <th className="pb-2 text-left text-[13px] font-medium text-ink-2">Window</th>
              <th className="pb-2 text-right text-[13px] font-medium text-ink-2">Current</th>
              <th className="pb-2 text-right text-[13px] font-medium text-ink-2">Proposed</th>
              <th className="pb-2 text-right text-[13px] font-medium text-ink-2">
                Current worst drop
              </th>
              <th className="pb-2 text-right text-[13px] font-medium text-ink-2">
                Proposed worst drop
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {stress.map((w) => (
              <tr key={w.key}>
                <td className="py-2 pr-3">
                  <span className="block text-[13px] text-ink">{w.label}</span>
                  <span className="tabular block text-[11px] text-ink-3">
                    {monthLabel(w.start)} – {monthLabel(w.end)}
                  </span>
                </td>
                {w.available ? (
                  <>
                    <ReturnCell pct={w.currentReturn} dollars={w.currentDollars} />
                    <ReturnCell pct={w.proposedReturn} dollars={w.proposedDollars} />
                    <td className="py-2 text-right text-[13px]">
                      <MoneyText value={w.currentDrawdown} format="pct" />
                    </td>
                    <td className="py-2 text-right text-[13px]">
                      <MoneyText value={w.proposedDrawdown} format="pct" />
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="py-2 text-right">
                    <SectionNote>{w.unavailableReason ?? "Not available."}</SectionNote>
                  </td>
                )}
              </tr>
            ))}
            {stress.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-[13px] text-ink-4">
                  No stress windows configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
