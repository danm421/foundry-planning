"use client";

import { useMemo } from "react";
import type { RecipientTotal } from "@/lib/estate/transfer-report";
import { assignRecipientColors } from "./estate-transfer-chart-colors";
import { EstateTransferDistributionBar } from "./estate-transfer-distribution-bar";
import { EstateTransferRecipientBars } from "./estate-transfer-recipient-bars";

interface Props {
  totals: RecipientTotal[];
}

export function EstateTransferCharts({ totals }: Props) {
  const sorted = useMemo(() => sortPanel(totals), [totals]);
  const colors = useMemo(() => assignRecipientColors(sorted), [sorted]);

  if (sorted.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Where it ends up — at-a-glance
          </span>
          <h2 className="text-base font-semibold text-gray-50">
            Beneficiary breakdown
          </h2>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-5 px-5 py-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
            Distribution share
          </p>
          <EstateTransferDistributionBar totals={sorted} colors={colors} />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
            By recipient — 1st vs 2nd death
          </p>
          <EstateTransferRecipientBars totals={sorted} colors={colors} />
        </div>
      </div>
    </section>
  );
}

/**
 * Spouse pinned first, then descending by total. Mirrors the per-death
 * recipient sort in transfer-report.ts so charts and the death sections
 * agree on order.
 */
function sortPanel(totals: RecipientTotal[]): RecipientTotal[] {
  return [...totals].sort((a, b) => {
    if (a.recipientKind === "spouse" && b.recipientKind !== "spouse") return -1;
    if (b.recipientKind === "spouse" && a.recipientKind !== "spouse") return 1;
    return b.total - a.total;
  });
}
