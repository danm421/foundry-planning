"use client";

import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import { LINKED_SOURCE_NAME, type LinkedStatus } from "@/lib/accounts/linked-source";
import { LinkedSourceBadge } from "@/components/balance-sheet/icons";

export interface AccountCardData {
  id: string;
  name: string;
  last4: string | null;
  /** "Retirement · 401k" for assets, "Mortgage" for debts. */
  subtitle: string;
  value: number;
  /** Null = typed in by hand. */
  linked: LinkedStatus | null;
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
        <span className="flex min-w-0 items-center gap-1.5">
          {card.linked && <LinkedSourceBadge status={card.linked} />}
          <span className="truncate text-[14px] font-medium text-ink">
            {card.name}
            {card.last4 && <span className="tabular ml-1 text-[12px] text-ink-3">·· {card.last4}</span>}
          </span>
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-3">{card.subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tabular block text-[14px] text-ink">{fmtUsd(card.value)}</span>
        <span className="mt-0.5 block text-[12px] text-ink-3">
          {card.linked ? LINKED_SOURCE_NAME[card.linked.source] : "Manual"}
        </span>
      </span>
    </button>
  );
}
