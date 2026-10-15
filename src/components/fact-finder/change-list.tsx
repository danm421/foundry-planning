"use client";
// src/components/fact-finder/change-list.tsx
// The review's change list, shown in place of a fact finder page: what saving
// would create or update on the plan, page by page and field by field ("on
// record → new"), each field with a tick. A line that can't save says why and
// goes back to the cell to fix; unchanged lines fold away. Saving arrives in
// the next plan. Imports only client-safe leaf modules from src/lib/fact-finder.
import { Fragment, memo, useId } from "react";
import { Card } from "@/components/card";
import { countLines, type CellRef, type ChangeField, type ChangeLine, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { TARGETS, type ValueKind } from "@/lib/fact-finder/placement/targets";
import { EMPTY } from "@/lib/fact-finder/placement/values";
import { PAGE_ORDER, findSection } from "@/lib/fact-finder/schema";
import { GHOST_BUTTON } from "./button-styles";
import { AlertIcon, ChevronDownIcon, SparklesIcon } from "./icons";

export interface ChangeListProps {
  changeSet: ChangeSet;
  ticks: ChangeTicks;
  onToggleField(lineId: string, key: string): void;
  onToggleLine(lineId: string): void;
  /** Back to the fact finder at the cell to fix, else at the line's section. */
  onFix(cell: CellRef | undefined, sectionId: string): void;
  onBack(): void;
}

type GroupProps = Omit<ChangeListProps, "changeSet" | "onBack">;
/** A line gets only its own ticks, so ticking a box re-renders that line alone. */
type LineProps = Omit<GroupProps, "ticks"> & { line: ChangeLine; lineTicks: Record<string, boolean> | undefined };

const SAVE_REASON = "Saving arrives in the next update.";
const CHECKBOX = "h-4 w-4 cursor-pointer rounded accent-accent";
const CHIP = "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium";
const HEAD = "pb-1 text-left text-xs font-medium text-ink-3";
// Under 28rem (the list beside the open documents panel) each field stacks: its label, then on record → new.
const CELL = "border-t border-hair py-1.5 align-top @max-md:border-t-0 @max-md:py-0";

const sectionLabel = (line: ChangeLine) => findSection(line.sectionId)?.label;

/** "12 to create · 8 to update · 3 can't save · 5 unchanged", leaving out what there's none of. */
/** The heading over the review, wherever it shows (the list, or the notice that it's out of date). */
export function ChangesHeading() {
  return <h2 className="text-lg font-semibold text-ink">Changes to the plan</h2>;
}

export function BackToFactFinder({ onClick }: { onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={GHOST_BUTTON}>
      <span aria-hidden="true">←</span>
      Back to fact finder
    </button>
  );
}

function Summary({ lines }: { lines: readonly ChangeLine[] }) {
  const { creates, updates, blocked, unchanged } = countLines(lines);
  const parts = (
    [
      [creates, "to create"],
      [updates, "to update"],
      [blocked, "can't save"],
      [unchanged, "unchanged"],
    ] as const
  ).filter(([n]) => n > 0);
  if (parts.length === 0) return <p className="text-sm text-ink-2">Nothing here changes the plan.</p>;
  return (
    <p className="text-sm text-ink-2">
      {parts.map(([n, words], i) => (
        <Fragment key={words}>
          {i > 0 && <span className="text-ink-4"> · </span>}
          <span className="tabular">{n}</span> {words}
        </Fragment>
      ))}
    </p>
  );
}

const FIGURE_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>([
  "money", "number", "integer", "year", "month", "rate", "percent", "date", "monthYear",
]);

/** Whether a field's value is a figure (an amount, a rate, a date), set in mono; its text may hold digits without being one. */
function isFigure(target: ChangeLine["target"], key: string): boolean {
  const kind = TARGETS[target]?.fields[key]?.kind;
  return kind !== undefined && FIGURE_KINDS.has(kind);
}

/** A shown value; only a figure-kind field's value is set in mono. */
function Value({ text, tone, figure }: { text: string | undefined; tone: string; figure: boolean }) {
  if (!text || text === EMPTY) return <span className="text-ink-4">{EMPTY}</span>;
  return <span className={`break-words ${tone}${figure ? " tabular" : ""}`}>{text}</span>;
}

/** The words a field the AI step placed came from, on hover or focus. */
function AiQuote({ quote }: { quote: string }) {
  const id = useId();
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label="Placed by AI"
        aria-describedby={id}
        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
      >
        <SparklesIcon className="h-3.5 w-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-50 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-hair bg-card px-3 py-2 text-xs leading-snug text-ink-2 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        Placed by AI from “{quote}”
      </span>
    </span>
  );
}

function FieldRow({ line, field, tickable, ticked, onToggle }: {
  line: ChangeLine;
  field: ChangeField;
  tickable: boolean;
  ticked: boolean;
  onToggle(): void;
}) {
  const update = line.action === "update";
  const figure = isFigure(line.target, field.key);
  // Stacked: the checkbox (when there is one) in the first track, the label across the rest, the values under it.
  const stacked = update ? "@max-md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]" : "@max-md:grid-cols-[auto_minmax(0,1fr)]";
  return (
    <tr className={`@max-md:grid @max-md:gap-y-0.5 @max-md:border-t @max-md:border-hair @max-md:py-1.5 ${stacked}`}>
      {tickable && (
        <td className={`${CELL} @max-md:pr-2`}>
          <input
            type="checkbox"
            checked={ticked}
            onChange={onToggle}
            aria-label={`Include ${field.label}`}
            className={CHECKBOX}
          />
        </td>
      )}
      <th scope="row" className={`${CELL} break-words pr-3 text-left font-normal text-ink-2 @max-md:col-[2/-1]`}>
        {field.label}
        {field.ai && <AiQuote quote={field.ai.quote} />}
      </th>
      {update && (
        <>
          <td className={`${CELL} pr-2 @max-md:col-start-2`}>
            <Value text={field.shown.onRecord} tone="text-ink-3" figure={figure} />
          </td>
          <td aria-hidden="true" className={`${CELL} text-ink-4 @max-md:pr-2`}>
            →
          </td>
        </>
      )}
      <td className={update ? CELL : `${CELL} @max-md:col-start-2`}>
        <Value text={field.shown.next} tone="text-ink" figure={figure} />
      </td>
    </tr>
  );
}

const LineItem = memo(function LineItem({ line, lineTicks: ownTicks, onToggleField, onToggleLine, onFix }: LineProps) {
  const headingId = useId();
  const tickable = !line.blocked && line.action !== "none";
  const lineTicks = ownTicks ?? {};
  const tickedCount = line.fields.filter((f) => lineTicks[f.key]).length;
  const all = line.fields.length > 0 && tickedCount === line.fields.length;
  const update = line.action === "update";
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-2 px-[var(--pad-card)] py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {tickable && line.fields.length > 0 && (
          <input
            type="checkbox"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = tickedCount > 0 && !all;
            }}
            onChange={() => onToggleLine(line.id)}
            aria-label={`Include all of ${line.label}`}
            className={CHECKBOX}
          />
        )}
        {line.action !== "none" && (
          <span className={`${CHIP} ${update ? "border-hair-2 bg-card-2 text-ink-2" : "border-good/40 text-good"}`}>
            {update ? "Update" : "Create"}
          </span>
        )}
        <h4 id={headingId} className="text-sm font-medium text-ink">
          {line.label}
        </h4>
        <span className="text-xs text-ink-3">{sectionLabel(line)}</span>
        {line.aiPlaced && (
          <span className={`${CHIP} border-hair-2 text-ink-3`}>
            <SparklesIcon className="h-3 w-3" />
            AI placed
          </span>
        )}
      </div>
      <div className={`flex flex-col gap-2 ${tickable ? "pl-6 @max-md:pl-0" : ""}`}>
        {line.blocked && (
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/15 px-3 py-2 text-sm text-crit">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{line.blocked.reason}</span>
            <button
              type="button"
              onClick={() => onFix(line.blocked?.cell, line.sectionId)}
              className="shrink-0 cursor-pointer font-medium text-ink-2 underline underline-offset-2 hover:text-ink hover:no-underline"
            >
              Fix in fact finder
            </button>
          </div>
        )}
        {line.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-2 text-xs text-warn">
            <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{warning}</span>
          </p>
        ))}
        {line.action === "none" && !line.blocked && <p className="text-sm text-ink-3">No changes</p>}
        {line.fields.length > 0 && (
          <table aria-labelledby={headingId} className="w-full table-fixed border-separate border-spacing-0 text-sm @max-md:block">
            <colgroup className="@max-md:hidden">
              {tickable && <col className="w-8" />}
              <col className="w-[30%]" />
              {update && (
                <>
                  <col />
                  <col className="w-6" />
                </>
              )}
              <col />
            </colgroup>
            <thead className="@max-md:sr-only">
              <tr>
                {tickable && <td className={HEAD} />}
                <th scope="col" className={HEAD}>
                  Field
                </th>
                {update && (
                  <>
                    <th scope="col" className={HEAD}>
                      On record
                    </th>
                    <td className={HEAD} />
                  </>
                )}
                <th scope="col" className={HEAD}>
                  New
                </th>
              </tr>
            </thead>
            <tbody className="@max-md:block">
              {line.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  line={line}
                  field={field}
                  tickable={tickable}
                  ticked={lineTicks[field.key] === true}
                  onToggle={() => onToggleField(line.id, field.key)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
});

/** A page's lines that change nothing, folded into one closed disclosure. */
function Unchanged({ lines }: { lines: readonly ChangeLine[] }) {
  return (
    <details className="group px-[var(--pad-card)] py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon className="h-4 w-4 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" />
        <span>
          <span className="tabular">{lines.length}</span> unchanged
        </span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1 pl-6">
        {lines.map((line) => (
          <li key={line.id} className="text-sm text-ink-2">
            {line.label} <span className="text-xs text-ink-3">{sectionLabel(line)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PageGroup({ label, lines, ticks, ...lineProps }: GroupProps & { label: string; lines: readonly ChangeLine[] }) {
  const headingId = useId();
  // An unchanged line with a warning stays in view; the rest fold away.
  const unchanged = lines.filter((l) => !l.blocked && l.action === "none" && l.warnings.length === 0);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-ink-2">
        {label}
      </h3>
      <Card className="divide-y divide-hair">
        {lines
          .filter((l) => !unchanged.includes(l))
          .map((line) => (
            <LineItem key={line.id} line={line} lineTicks={ticks[line.id]} {...lineProps} />
          ))}
        {unchanged.length > 0 && <Unchanged lines={unchanged} />}
      </Card>
    </section>
  );
}

export function ChangeList({ changeSet, onBack, ...lineProps }: ChangeListProps) {
  const saveReasonId = useId();
  return (
    <div className="@container flex flex-col gap-4">
      <ChangesHeading />
      <Summary lines={changeSet.lines} />
      {changeSet.notices.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
          {changeSet.notices.map((notice, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
              <span>{notice}</span>
            </li>
          ))}
        </ul>
      )}
      {PAGE_ORDER.map(({ id, label }) => {
        const lines = changeSet.lines.filter((l) => l.page === id);
        return lines.length > 0 && <PageGroup key={id} label={label} lines={lines} {...lineProps} />;
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-4">
        <BackToFactFinder onClick={onBack} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p id={saveReasonId} className="text-xs text-ink-3">
            {SAVE_REASON}
          </p>
          <button
            type="button"
            disabled
            aria-describedby={saveReasonId}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save to plan
          </button>
        </div>
      </div>
    </div>
  );
}
