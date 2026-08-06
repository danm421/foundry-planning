"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { IntakeFormRow } from "@/lib/intake/queries";
import { ChevronRightIcon } from "@/components/icons";

export interface QueueGroup {
  label: string;
  forms: IntakeFormRow[];
  /** Copy shown in the panel when this bucket is empty. */
  empty?: string;
}

interface QueueProps {
  groups: QueueGroup[];
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

// Who the form is FOR, which is `clientId` — not `mode`. A blank form can be
// addressed to someone already on the roster (its answers merge onto their
// plan), so reading the recipient off the mode would label those "Prospect".
const recipientLabel = (form: IntakeFormRow): "Client" | "Prospect" =>
  form.clientId ? "Client" : "Prospect";

/**
 * Per-status presentation: a plain-language label, the pip colour, and which
 * timestamp is the meaningful one for that state. Status is carried by the word
 * as well as the pip, so it never rests on colour alone.
 *
 * Keyed by the status enum rather than `string`, so adding a sixth intake
 * status fails the build here instead of rendering an unlabelled row.
 */
const STATUS_META: Record<
  IntakeFormRow["status"],
  { label: string; pip: string; text: string; at: (f: IntakeFormRow) => Date | null }
> = {
  draft: {
    label: "Awaiting reply",
    pip: "bg-ink-4",
    text: "text-ink-3",
    at: (f) => f.sentAt ?? f.createdAt,
  },
  submitted: {
    label: "Ready to review",
    pip: "bg-accent",
    text: "text-accent",
    at: (f) => f.submittedAt ?? f.createdAt,
  },
  applied: {
    label: "Applied",
    pip: "bg-good",
    text: "text-good",
    at: (f) => f.appliedAt ?? f.submittedAt ?? f.createdAt,
  },
  discarded: {
    label: "Discarded",
    pip: "bg-ink-4",
    text: "text-ink-4",
    at: (f) => f.updatedAt,
  },
  expired: {
    label: "Expired",
    pip: "bg-warn",
    text: "text-warn",
    at: (f) => f.expiresAt ?? f.updatedAt,
  },
};

/**
 * The Data Collection queue, split into tabs — one per lifecycle bucket. The
 * tab strip replaces the stacked section headings it grew out of: with three
 * buckets on one page the eye had to scan past the two it didn't care about.
 */
export default function Queue({ groups }: QueueProps) {
  const baseId = useId();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  // Land on the first bucket that actually has something in it. Opening on an
  // empty tab when work is waiting one tab over is the thing to avoid; the
  // declared order still wins whenever more than one bucket has rows.
  const [active, setActive] = useState(() => {
    const i = groups.findIndex((g) => g.forms.length > 0);
    return i === -1 ? 0 : i;
  });

  function onKeyDown(e: React.KeyboardEvent) {
    const last = groups.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabsRef.current[next]?.focus();
  }

  return (
    <section>
      <div className="border-b border-hair">
        <div
          role="tablist"
          aria-label="Intake form status"
          onKeyDown={onKeyDown}
          className="-mb-px flex items-center gap-1 overflow-x-auto"
        >
          {groups.map((group, i) => {
            const selected = i === active;
            return (
              <button
                key={group.label}
                ref={(el) => {
                  tabsRef.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${i}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${i}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-3 pt-2 text-[14px] font-medium transition-colors focus-visible:rounded-t-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  selected
                    ? "border-accent text-ink"
                    : "border-transparent text-ink-3 hover:border-hair-2 hover:text-ink"
                }`}
              >
                {group.label}
                <span
                  className={`tabular rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
                    selected ? "bg-accent-wash text-accent" : "bg-card-2 text-ink-3"
                  }`}
                >
                  {group.forms.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {groups.map((group, i) => (
        <div
          key={group.label}
          role="tabpanel"
          id={`${baseId}-panel-${i}`}
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={i !== active}
          className="pt-4"
        >
          {group.forms.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-hair px-6 py-12 text-center text-[14px] text-ink-3">
              {group.empty ?? "Nothing here yet."}
            </p>
          ) : (
            <div className="divide-y divide-hair overflow-hidden rounded-[var(--radius-md)] border border-hair bg-card">
              {group.forms.map((form) => (
                <FormRow key={form.id} form={form} />
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function FormRow({ form }: { form: IntakeFormRow }) {
  const meta = STATUS_META[form.status];

  return (
    <Link
      href={`/data-collection/${form.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium text-ink">
            {form.recipientName ?? form.recipientEmail}
          </span>
          <span className="shrink-0 rounded-full border border-hair-2 px-2 py-0.5 text-[11px] leading-none text-ink-3">
            {recipientLabel(form)}
          </span>
        </div>
        <div className="mt-1 truncate text-[12px] text-ink-3">{form.recipientEmail}</div>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        {/* The word carries the status, the pip only reinforces it — History
            mixes three states in one list, so colour alone won't do. */}
        <span className={`flex items-center gap-1.5 whitespace-nowrap text-[12px] ${meta.text}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.pip}`} />
          {meta.label}
        </span>
        <span className="tabular hidden text-[12px] text-ink-3 sm:inline">
          {formatDate(meta.at(form))}
        </span>
        <ChevronRightIcon
          width={16}
          height={16}
          aria-hidden="true"
          className="text-ink-4 transition-colors group-hover:text-ink-2"
        />
      </div>
    </Link>
  );
}
