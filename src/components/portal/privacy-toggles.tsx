"use client";

import { useState, type ReactElement } from "react";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { PortalPrivacy } from "@/lib/portal/privacy";

const ROWS: ReadonlyArray<{
  key: keyof PortalPrivacy;
  label: string;
  description: string;
}> = [
  {
    key: "shareTransactions",
    label: "Transactions",
    description: "Your transaction feed, including the to-review queue.",
  },
  {
    key: "shareBudgets",
    label: "Budget",
    description: "Budget amounts and spending by category.",
  },
  {
    key: "shareRecurrings",
    label: "Recurring bills",
    description: "The bills and subscriptions you track.",
  },
];

/**
 * The three advisor-sharing switches. Optimistic: flips immediately, reverts
 * with an error line if the save fails. `readOnly` renders the advisor-preview
 * state — visible but not operable (sharing is the client's decision).
 */
export function PrivacyToggles({
  initial,
  readOnly = false,
}: {
  initial: PortalPrivacy;
  readOnly?: boolean;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [flags, setFlags] = useState<PortalPrivacy>(initial);
  const [error, setError] = useState<string | null>(null);

  async function flip(key: keyof PortalPrivacy, next: boolean): Promise<void> {
    setError(null);
    const prev = flags;
    setFlags({ ...prev, [key]: next });
    try {
      const res = await portalFetch("/api/portal/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        setFlags(prev);
        setError("Couldn't save that change.");
      }
    } catch {
      setFlags(prev);
      setError("Couldn't save that change.");
    }
  }

  return (
    <div>
      <ul className="divide-y divide-hair">
        {ROWS.map((row) => {
          const on = flags[row.key];
          return (
            <li key={row.key} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-ink">{row.label}</div>
                <p className="text-[12px] text-ink-3">{row.description}</p>
              </div>
              <label
                className={`inline-flex shrink-0 items-center gap-2.5 ${readOnly ? "" : "cursor-pointer"}`}
              >
                <span className="text-[12px] text-ink-3">{on ? "Shared" : "Private"}</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Share ${row.label.toLowerCase()} with your advisor`}
                  checked={on}
                  disabled={readOnly}
                  onChange={(e) => void flip(row.key, e.target.checked)}
                  className="peer sr-only"
                />
                <span className="relative h-5 w-9 rounded-full bg-hair-2 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-[12px] text-crit">{error}</p>}
    </div>
  );
}
