import Link from "next/link";
import { requireOrgId } from "@/lib/db-helpers";
import { listFormsForFirm } from "@/lib/intake/queries";
import Queue, { type QueueGroup } from "@/components/intake/admin/queue";
import SendIntakeForm from "@/components/intake/admin/send-intake-form";
import { ExternalLinkIcon, PencilIcon } from "@/components/icons";

const headerActionCls =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-hair-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export default async function DataCollectionPage() {
  const orgId = await requireOrgId();
  const forms = await listFormsForFirm(orgId);

  // Order is the tab order: what you're waiting on, then what's waiting on you,
  // then the record. History stays a tab rather than a separate page so applied
  // and discarded forms are still one click from here.
  const groups: QueueGroup[] = [
    {
      label: "In flight",
      forms: forms.filter((f) => f.status === "draft"),
      // The chasing question: did they get it, and did they look? Sent alone
      // can't tell an ignored invite from one that's half-filled.
      dateColumns: ["sent", "accessed"],
      empty: "No forms are out with a client right now.",
    },
    {
      label: "Needs review",
      forms: forms.filter((f) => f.status === "submitted"),
      // Adds Completed — how long the whole round trip took, and how stale the
      // answers are by the time you open them.
      dateColumns: ["sent", "accessed", "completed"],
      empty: "Nothing to review. Submitted forms land here.",
    },
    {
      label: "History",
      forms: forms.filter(
        (f) => f.status === "applied" || f.status === "discarded" || f.status === "expired",
      ),
      // One date: this is the record, and the only question it answers is when
      // the form left the queue. Which timestamp that is varies by end state.
      dateColumns: ["closed"],
      empty: "No applied or discarded forms yet.",
    },
  ];

  // `w-full min-w-0`: the app shell's `main` is a flex container, so without it
  // this page inherits `min-width: auto` and inflates to its widest descendant's
  // min-content — the tab strip. Pinned to the column width, the strip scrolls
  // itself instead of pushing the page past a narrow viewport.
  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-6 py-10 sm:px-8 lg:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">
            Data Collection<span className="dot">.</span>
          </h1>
          <p className="mt-2 max-w-[52ch] text-[15px] leading-[1.55] text-ink-2">
            Send an intake form, then review what comes back before it touches a plan.
          </p>
        </div>
        {/* No `shrink-0` here: it would pin the group at its two-buttons-wide
            max-content and push the whole header past a narrow viewport. Let it
            shrink and the inner wrap stack the buttons instead. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/data-collection/email-settings" className={headerActionCls}>
            <PencilIcon width={14} height={14} aria-hidden="true" />
            Form settings
          </Link>
          <a
            href="/data-collection/preview"
            target="_blank"
            rel="noopener noreferrer"
            className={headerActionCls}
          >
            <ExternalLinkIcon width={14} height={14} aria-hidden="true" />
            Preview form
          </a>
        </div>
      </header>

      <div className="space-y-10">
        <SendIntakeForm />
        <Queue groups={groups} />
      </div>
    </div>
  );
}
