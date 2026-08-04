import Link from "next/link";
import type { ReactElement } from "react";
import { dismissEmailPromptAction } from "@/app/(app)/alerts/actions";

/**
 * Shown once. Email ships OFF for every one of the eighteen categories, which
 * is the safe default but also means the digest is a feature nobody discovers:
 * the inbox works without it, so there is no reason to open Settings and find
 * out it exists. This converts "never found it" into "was offered it once".
 *
 * Dismissal posts to a server action rather than flipping local state — the
 * choice has to survive a reload, so it lives in
 * `notification_preferences.email_prompt_dismissed_at`.
 */
export default function EmailPrompt(): ReactElement {
  return (
    <div className="mb-6 rounded-[var(--radius-sm)] border border-hair bg-card px-5 py-4">
      <p className="text-[14px] text-ink">
        Email is off for everything right now — alerts only appear here.
      </p>
      {/* Deliberately promises batching, not a daily message: the digest cron
          sends at most one email per advisor per day and skips the send
          entirely when nothing is pending. See api/cron/notification-digest. */}
      <p className="mt-1 text-[13px] text-ink-3">
        Turn on the ones worth an email and they arrive together in a single
        morning digest, never one message per alert.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <Link
          href="/alerts?tab=settings"
          className="rounded-[var(--radius-sm)] text-[13px] font-medium text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Choose what gets emailed{" "}
          {/* Decorative. The link text already says where it goes, and a bare
              arrow in the accessible name announces as "right arrow". */}
          <span aria-hidden="true">→</span>
        </Link>
        <form action={dismissEmailPromptAction}>
          <button
            type="submit"
            className="rounded-[var(--radius-sm)] text-[13px] text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {/* "No thanks" alone is ambiguous to anyone who tabs straight to it,
                but an aria-label would REPLACE the visible text and break WCAG
                2.5.3. Appending keeps the visible text inside the name. */}
            No thanks<span className="sr-only"> — hide this message</span>
          </button>
        </form>
      </div>
    </div>
  );
}
