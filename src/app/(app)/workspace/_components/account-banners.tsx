"use client";

import type { ReactElement } from "react";
import type { AccountError, AccountSummary } from "@/lib/workspace/types";

const LINE = "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2";
const ACTION =
  "text-[12px] text-ink underline underline-offset-2 hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const PROVIDER_NAME = { google: "Google", microsoft: "Microsoft" } as const;

/** One fixed line per visible account whose half of the week didn't load; the other accounts' meetings stay on screen. */
export function AccountBanners({
  accounts,
  results,
  hidden,
  onRetry,
}: {
  accounts: AccountSummary[];
  results: Array<{ connectionId: string; error: AccountError | null }>;
  hidden: ReadonlySet<string>;
  onRetry: () => void;
}): ReactElement | null {
  const lines = results.flatMap(({ connectionId, error }) => {
    const account = accounts.find((a) => a.id === connectionId);
    return error && account && !hidden.has(connectionId) ? [{ account, error }] : [];
  });
  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {lines.map(({ account, error }) => (
        <p key={account.id} role="status" className={LINE}>
          <span>
            {error === "needs_reconnect"
              ? `${account.email} needs to reconnect.`
              : error === "throttled"
                ? `${PROVIDER_NAME[account.provider]} is busy — ${account.email}'s meetings aren't shown. Try again in a minute.`
                : `Couldn't load ${account.email}'s meetings.`}
          </span>
          {error === "needs_reconnect" ? (
            <a
              href={`/api/workspace/${account.provider}/connect?hint=${encodeURIComponent(account.email)}`}
              className={ACTION}
            >
              Reconnect
            </a>
          ) : (
            <button type="button" onClick={onRetry} className={ACTION}>
              Retry
            </button>
          )}
        </p>
      ))}
    </div>
  );
}
