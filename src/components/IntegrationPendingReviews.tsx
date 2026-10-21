import Link from "next/link";
import type { OpenReview } from "@/lib/integrations/reviews";

interface Props {
  label: string;
  reviews: OpenReview[];
}

/**
 * Synced accounts that are parked until an advisor reviews them. The review
 * itself lives under each client's Details → Import; this puts a way in on the
 * integration page, where the advisor just pressed Sync.
 */
export function IntegrationPendingReviews({ label, reviews }: Props) {
  if (reviews.length === 0) return null;

  return (
    <section
      aria-labelledby="pending-reviews-heading"
      className="flex flex-col gap-3 rounded border border-hair bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id="pending-reviews-heading" className="text-sm font-medium text-ink">
          Waiting for your review
        </h3>
        <p className="text-sm text-ink-3">
          Accounts from {label} reach a plan only after you review them.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-hair">
        {reviews.map((r) => {
          const accounts = r.accountCount === 1 ? "account" : "accounts";
          return (
            <li
              key={r.importId}
              className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="truncate text-sm text-ink">{r.householdName}</span>
                <span className="shrink-0 text-sm text-ink-3">
                  <span className="tabular">{r.accountCount}</span> {accounts}
                </span>
              </div>
              <Link
                href={`/clients/${r.clientId}/details/import/${r.importId}`}
                className="btn-primary shrink-0 text-sm"
                aria-label={`Review ${r.accountCount} ${accounts} for ${r.householdName}`}
              >
                Review
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
