"use client";

import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";

export interface AccountCardData {
  id: string;
  name: string;
  last4: string | null;
  /** "Retirement · 401k" for assets, "Mortgage" for debts. */
  subtitle: string;
  value: number;
  isPlaidLinked: boolean;
}

/**
 * One account, pure readout. Edit and delete live in the drill-down detail, so
 * the whole card is a single click target.
 */
export function AccountCard({
  card,
  onOpen,
}: {
  card: AccountCardData;
  onOpen: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-hair bg-card p-4 text-left hover:bg-card-hover"
    >
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-ink">
          {card.name}
          {card.last4 && <span className="tabular ml-1 text-[12px] text-ink-3">·· {card.last4}</span>}
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-3">{card.subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tabular block text-[14px] text-ink">{fmtUsd(card.value)}</span>
        <span className="mt-0.5 block text-[12px] text-ink-3">
          {card.isPlaidLinked ? "Plaid" : "Manual"}
        </span>
      </span>
    </button>
  );
}
