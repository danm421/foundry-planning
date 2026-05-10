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
  const estateValue =
    section.assetEstateValue + section.reconciliation.sumLiabilityTransfers;
  const debtAssumed = section.reconciliation.sumLiabilityTransfers;
  const reductionsTotal = section.reconciliation.sumReductions;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">
            Estate transfer
          </span>
          <h2 className="text-base font-semibold text-gray-50">{heading}</h2>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
            Estate at death
          </span>
          <span className="text-xl font-semibold tabular-nums text-gray-50">
            {fmt.format(estateValue)}
          </span>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {section.recipients.length === 0 && (
          <p className="text-sm text-gray-400">No transfers in this death event.</p>
        )}
        {section.recipients.map((r) => (
          <EstateTransferRecipientCard key={r.key} group={r} />
        ))}
        <EstateTransferReductionsCard
          reductions={section.reductions}
          taxableEstate={section.taxableEstate}
        />
        <EstateTransferConflictsCallout conflicts={section.conflicts} />

        {section.reconciliation.reconciles ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-gray-800/60 pt-2 text-[11px] text-gray-500">
            <span>
              <span className="text-emerald-400">✓</span> Reconciled · {fmt.format(section.assetEstateValue)} flows to recipients
              {debtAssumed !== 0 && (
                <> · {fmt.format(Math.abs(debtAssumed))} debt assumed</>
              )}
              {reductionsTotal > 0 && (
                <> · {fmt.format(reductionsTotal)} drained for taxes &amp; expenses</>
              )}
            </span>
            <span className="tabular-nums text-gray-400">
              Net to recipients {fmt.format(section.reconciliation.sumRecipients)}
            </span>
          </div>
        ) : (
          <div className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
            Unattributed: {fmt.format(section.reconciliation.unattributed)} — internal
            ledger inconsistency. Asset transfers ({fmt.format(section.assetEstateValue)})
            + liabilities ({fmt.format(debtAssumed)}) do not match recipient totals
            ({fmt.format(section.reconciliation.sumRecipients)}). Review.
          </div>
        )}
      </div>
    </section>
  );
}
