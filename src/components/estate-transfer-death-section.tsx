import type { DeathSectionData } from "@/lib/estate/transfer-report";
import { EstateTransferRecipientCard } from "./estate-transfer-recipient-card";
import { EstateTransferReductionsCard } from "./estate-transfer-reductions-card";
import { EstateTransferConflictsCallout } from "./estate-transfer-conflicts-callout";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EstateTransferDeathSection({
  heading,
  section,
}: {
  heading: string;
  section: DeathSectionData;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950 shadow-2xl shadow-black/30">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-gray-800 px-6 py-5">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-gray-500">
            Estate transfer
          </div>
          <h2 className="mt-1.5 text-xl font-semibold text-gray-50">{heading}</h2>
        </div>
        <div className="rounded-lg bg-gray-900/60 px-4 py-2 text-right ring-1 ring-gray-700/50">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
            Estate value at death
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-gray-50">
            {fmt.format(section.assetEstateValue + section.reconciliation.sumLiabilityTransfers)}
          </div>
        </div>
      </header>

      <div className="space-y-4 p-6">
        {section.recipients.length === 0 && (
          <p className="text-sm text-gray-400">No transfers in this death event.</p>
        )}
        {section.recipients.map((r) => (
          <EstateTransferRecipientCard key={r.key} group={r} />
        ))}
        <EstateTransferReductionsCard
          reductions={section.reductions}
          grossEstate={section.grossEstate}
        />
        <EstateTransferConflictsCallout conflicts={section.conflicts} />

        <div
          className={
            "flex flex-wrap items-baseline justify-between gap-3 rounded border px-4 py-2 text-xs " +
            (section.reconciliation.reconciles
              ? "border-gray-800/60 bg-gray-950/40 text-gray-400"
              : "border-amber-900/40 bg-amber-950/20 text-amber-200")
          }
        >
          {section.reconciliation.reconciles ? (
            <span>
              Estate value of {fmt.format(section.assetEstateValue)} flows to recipients
              {section.reconciliation.sumLiabilityTransfers !== 0 && (
                <>
                  {" "}net of {fmt.format(Math.abs(section.reconciliation.sumLiabilityTransfers))} in
                  inherited debt (recipients receive {fmt.format(section.reconciliation.sumRecipients)} net)
                </>
              )}
              .{section.reconciliation.sumReductions > 0 && (
                <>
                  {" "}Reductions ({fmt.format(section.reconciliation.sumReductions)}) are
                  drained from recipient assets after the routing pass.
                </>
              )}
            </span>
          ) : (
            <span>
              Unattributed: {fmt.format(section.reconciliation.unattributed)} — internal
              ledger inconsistency. Asset transfers ({fmt.format(section.assetEstateValue)})
              + liabilities ({fmt.format(section.reconciliation.sumLiabilityTransfers)}) do not match
              recipient totals ({fmt.format(section.reconciliation.sumRecipients)}). Review.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
