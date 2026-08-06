"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { IntakeFormRow } from "@/lib/intake/queries";
import { ChevronRightIcon } from "@/components/icons";

/** A date column a bucket can show. See `DATE_COLUMNS` for what each reads. */
export type QueueDateColumn = "sent" | "accessed" | "completed" | "closed";

export interface QueueGroup {
  label: string;
  forms: IntakeFormRow[];
  /**
   * Date columns this bucket shows, left to right. Required, not defaulted:
   * which dates matter is a property of the bucket, and a silent default would
   * let a new tab ship showing the wrong one.
   */
  dateColumns: QueueDateColumn[];
  /** Copy shown in the panel when this bucket is empty. */
  empty?: string;
}

interface QueueProps {
  groups: QueueGroup[];
}

// Built once: a row now renders up to three dates instead of one, and every
// tab-switch re-renders every bucket's rows.
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return DATE_FORMAT.format(new Date(d));
}

// Who the form is FOR, which is `clientId` — not `mode`. A blank form can be
// addressed to someone already on the roster (its answers merge onto their
// plan), so reading the recipient off the mode would label those "Prospect".
const recipientLabel = (form: IntakeFormRow): "Client" | "Prospect" =>
  form.clientId ? "Client" : "Prospect";

/**
 * Per-status presentation: a plain-language label and the pip colour. Status is
 * carried by the word as well as the pip, so it never rests on colour alone.
 *
 * Keyed by the status enum rather than `string`, so adding a sixth intake
 * status fails the build here instead of rendering an unlabelled row.
 */
const STATUS_META: Record<IntakeFormRow["status"], { label: string; pip: string; text: string }> = {
  draft: { label: "Awaiting reply", pip: "bg-ink-4", text: "text-ink-3" },
  submitted: { label: "Ready to review", pip: "bg-accent", text: "text-accent" },
  applied: { label: "Applied", pip: "bg-good", text: "text-good" },
  discarded: { label: "Discarded", pip: "bg-ink-4", text: "text-ink-4" },
  expired: { label: "Expired", pip: "bg-warn", text: "text-warn" },
};

/**
 * History mixes three end states in one list, and each ends on a different
 * column — so its single date stays status-aware. This is the last of the old
 * per-status `at()` map: the other buckets now name their dates outright.
 */
function closedAt(f: IntakeFormRow): Date | null {
  switch (f.status) {
    case "applied":
      return f.appliedAt ?? f.submittedAt ?? f.createdAt;
    case "expired":
      return f.expiresAt ?? f.updatedAt;
    default:
      return f.updatedAt;
  }
}

/**
 * The date columns a bucket can show. `accessed` and `completed` deliberately
 * do NOT fall back to another timestamp: an em-dash is the honest answer to
 * "have they opened it yet?", and a fallback would read as a date they acted.
 * (`sent` keeps its defensive `createdAt` fallback for a nullable column — the
 * one insert site always writes `sentAt`, so it should never surface.)
 */
const DATE_COLUMNS: Record<
  QueueDateColumn,
  { header: string; at: (f: IntakeFormRow) => Date | null }
> = {
  sent: { header: "Sent", at: (f) => f.sentAt ?? f.createdAt },
  accessed: { header: "Accessed", at: (f) => f.openedAt },
  completed: { header: "Completed", at: (f) => f.submittedAt },
  closed: { header: "Closed", at: closedAt },
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
            // One grid for the whole bucket, and every row re-uses its tracks
            // via `grid-cols-subgrid`. That is what keeps the header sitting
            // over its own column: sibling grids with `auto` tracks would each
            // size to their own content and drift apart.
            <div
              className="grid divide-y divide-hair overflow-hidden rounded-[var(--radius-md)] border border-hair bg-card"
              style={{
                // recipient | status | one track per date | chevron. Built as a
                // list rather than CSS `repeat()`, which rejects a count of 0
                // and would drop the whole declaration for a dateless bucket.
                gridTemplateColumns: [
                  "minmax(0,1fr)",
                  "auto",
                  ...group.dateColumns.map(() => "auto"),
                  "1rem",
                ].join(" "),
              }}
            >
              <ColumnHeader columns={group.dateColumns} />
              {group.forms.map((form) => (
                <FormRow key={form.id} form={form} columns={group.dateColumns} />
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * Column titles, in sentence case at row-text size — deliberately NOT the
 * 11px uppercase caption treatment. Hidden below `md` alongside the dates it
 * titles, so the narrow layout is unchanged.
 */
function ColumnHeader({ columns }: { columns: QueueDateColumn[] }) {
  return (
    <div className="col-span-full hidden grid-cols-subgrid px-4 pb-2 pt-2.5 sm:px-5 md:grid">
      {/* Placeholders for the recipient and status tracks: the dates have to
          land in tracks 3..n, and auto-placement fills left to right. */}
      <span />
      <span />
      {columns.map((key) => (
        <span key={key} className="pl-4 text-[12px] text-ink-3">
          {DATE_COLUMNS[key].header}
        </span>
      ))}
    </div>
  );
}

/**
 * `pl-4` rather than a grid `gap`: a hidden cell vacates its track but a gap
 * survives it, so three hidden dates would leave three gaps of dead width at
 * 390px. Padding leaves with the cell it's on.
 */
function DateCell({ column, form }: { column: QueueDateColumn; form: IntakeFormRow }) {
  const { header, at } = DATE_COLUMNS[column];
  const value = at(form);

  return (
    <span className="tabular hidden whitespace-nowrap pl-4 text-[12px] text-ink-3 md:block">
      {/* The visible header isn't programmatically tied to the cell — these are
          links in a list, not a table — so each date names itself for AT. */}
      {value ? (
        <>
          <span className="sr-only">{header}: </span>
          {formatDate(value)}
        </>
      ) : (
        <>
          <span className="sr-only">{header}: not yet</span>
          <span aria-hidden="true">—</span>
        </>
      )}
    </span>
  );
}

function FormRow({ form, columns }: { form: IntakeFormRow; columns: QueueDateColumn[] }) {
  const meta = STATUS_META[form.status];

  return (
    <Link
      href={`/data-collection/${form.id}`}
      className="group col-span-full grid grid-cols-subgrid items-center px-4 py-3.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5"
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

      {/* The word carries the status, the pip only reinforces it — History
          mixes three states in one list, so colour alone won't do. */}
      <span
        className={`flex items-center gap-1.5 whitespace-nowrap pl-4 text-[12px] ${meta.text}`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.pip}`} />
        {meta.label}
      </span>

      {columns.map((key) => (
        <DateCell key={key} column={key} form={form} />
      ))}

      <ChevronRightIcon
        width={16}
        height={16}
        aria-hidden="true"
        // `ml-3` below md, where the dates are hidden and every pixel goes to
        // the truncated name; the old single-date row spent exactly this much
        // there. `md:ml-5` matches what it spent once a date is showing.
        className="ml-3 text-ink-4 transition-colors group-hover:text-ink-2 md:ml-5"
      />
    </Link>
  );
}
