"use client";
// src/components/fact-finder/section-tables.tsx
// The body of one fact finder section, by layout: a list (columns across, a
// row per entry), fixed rows (row labels down), transposed (fields down, a
// policy per column) or notes (one text box). Every value is a CellEditor;
// list and transposed rows can be removed or merged into another row. Sections
// that link to records get a "Links to" column (a field row when transposed).
import type { ReactNode } from "react";
import { selectChevronClassName } from "@/components/forms/input-styles";
import type { ClientOp } from "@/lib/fact-finder/ops";
import type { ColumnKind, FFColumn, FFSection, OWNER } from "@/lib/fact-finder/schema";
import { fixedLabelOfRow, rowLabel } from "@/lib/fact-finder/state";
import type { FFRow } from "@/lib/fact-finder/types";
import { CellEditor } from "./cell-editor";
import { TrashIcon } from "./icons";
import { LinkCell } from "./link-cell";

export interface SectionBodyProps {
  section: FFSection;
  rows: FFRow[];
  /** "rowId:columnId" of the cells the last chat reply changed. */
  changed: ReadonlySet<string>;
  onApply: (ops: ClientOp[]) => boolean;
  fileName: (fileId: string) => string | undefined;
  /** Id of the section's heading; it names the table. */
  labelledBy: string;
  /** What "Which trust / entity" offers: the Trusts section's names, then the client's existing trusts and entities. */
  ownerEntities: readonly string[];
}

/** The Owner choice that asks which trust or entity. */
const TRUST_OWNER: (typeof OWNER)[number] = "Trust / entity";

/** Narrowest a column gets, so its editor stays usable when the table scrolls sideways. */
const MIN_WIDTH: Record<ColumnKind, string> = {
  text: "min-w-40",
  notes: "min-w-56",
  money: "min-w-32",
  number: "min-w-24",
  percent: "min-w-24",
  integer: "min-w-20",
  year: "min-w-20",
  date: "min-w-36",
  monthYear: "min-w-36",
  choice: "min-w-40",
  check: "min-w-16",
};

const HEAD = "border-b border-hair px-2 py-2 text-left align-bottom text-xs font-medium text-ink-3";
// py-2 keeps a cell's × (6 px outside its corner) inside the table.
const CELL = "border-b border-hair px-2 py-2 align-top";
const ROW_HEAD = `${CELL} text-left text-sm font-medium text-ink-2`;
const STICKY_END = "sticky right-0 z-10 border-l border-hair bg-card";
const MERGE_SELECT =
  "h-7 w-28 rounded-[var(--radius-sm)] border border-hair bg-paper pl-2 text-xs text-ink-2 outline-none " +
  `hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 ${selectChevronClassName}`;

function cellFor({ section, changed, onApply, fileName, ownerEntities }: SectionBodyProps, row: FFRow, column: FFColumn) {
  let shown = column;
  if (column.id === "ownerEntity") {
    if (row.cells.owner?.value !== TRUST_OWNER) {
      return (
        <span title={`Choose one when Owner is “${TRUST_OWNER}”`} className="flex h-8 items-center px-2 text-ink-4">
          —
        </span>
      );
    }
    // Picked, not typed: the cell stores the chosen name.
    shown = { ...column, kind: "choice", options: ownerEntities };
  }
  return (
    <CellEditor
      sectionId={section.id}
      rowId={row.id}
      column={shown}
      cell={row.cells[column.id]}
      onApply={onApply}
      highlighted={changed.has(`${row.id}:${column.id}`)}
      fileName={fileName}
    />
  );
}

function linkFor({ section, changed, onApply }: SectionBodyProps, row: FFRow) {
  return (
    <LinkCell sectionId={section.id} row={row} onApply={onApply} highlighted={changed.has(`${row.id}:link`)} />
  );
}

/** A row's number on screen, with its label for screen readers. */
function NumberedLabel({ text, label }: { text: string; label: string }) {
  return (
    <>
      <span aria-hidden="true" className="tabular text-xs text-ink-4">
        {text}
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * Remove (to the tray) and Merge into another row of the section. Merge is a
 * native select: its list opens outside the page, so a table that scrolls
 * sideways can't clip it the way it would a dropdown menu.
 */
function RowActions({ section, rows, row, onApply }: Pick<SectionBodyProps, "section" | "rows" | "onApply"> & { row: FFRow }) {
  const label = rowLabel(section, row);
  const others = rows.filter((r) => r.id !== row.id);
  return (
    <div className="flex items-center gap-1">
      {others.length > 0 && (
        <select
          aria-label={`Merge ${label} into…`}
          value=""
          onChange={(e) => onApply([{ op: "mergeRows", sectionId: section.id, keepRowId: e.target.value, dropRowId: row.id }])}
          className={MERGE_SELECT}
        >
          <option value="">Merge into…</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>
              {`${rows.indexOf(other) + 1}. ${rowLabel(section, other)}`}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        title="Remove — it moves to Removed at the bottom of the page"
        onClick={() => onApply([{ op: "removeRow", sectionId: section.id, rowId: row.id }])}
        className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-card-2 hover:text-crit"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/** Wide sections scroll sideways inside their card. */
function TableFrame({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto px-[calc(var(--pad-card)-0.5rem)] pb-2">
      <table aria-labelledby={labelledBy} className="min-w-full border-separate border-spacing-0 text-sm">
        {children}
      </table>
    </div>
  );
}

function ColumnHeads({ columns }: { columns: readonly FFColumn[] }) {
  return columns.map((column) => (
    <th key={column.id} scope="col" className={HEAD}>
      <div className={MIN_WIDTH[column.kind]}>{column.label}</div>
    </th>
  ));
}

function ListTable(props: SectionBodyProps) {
  const { section, rows, onApply, labelledBy } = props;
  return (
    <TableFrame labelledBy={labelledBy}>
      <thead>
        <tr>
          <td className={HEAD} />
          <ColumnHeads columns={section.columns} />
          {section.links && (
            <th scope="col" className={HEAD}>
              Links to
            </th>
          )}
          <td className={`${HEAD} ${STICKY_END}`} />
        </tr>
      </thead>
      <tbody className="[&>tr:last-child>*]:border-b-0">
        {rows.map((row, i) => (
          <tr key={row.id}>
            <th scope="row" className={ROW_HEAD}>
              <NumberedLabel text={String(i + 1)} label={rowLabel(section, row)} />
            </th>
            {section.columns.map((column) => (
              <td key={column.id} className={CELL}>
                {cellFor(props, row, column)}
              </td>
            ))}
            {section.links && <td className={CELL}>{linkFor(props, row)}</td>}
            <td className={`${CELL} ${STICKY_END}`}>
              <RowActions section={section} rows={rows} row={row} onApply={onApply} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

function FixedRowsTable(props: SectionBodyProps) {
  const { section, rows, labelledBy } = props;
  return (
    <TableFrame labelledBy={labelledBy}>
      <thead>
        <tr>
          <td className={HEAD} />
          <ColumnHeads columns={section.columns} />
          {section.links && (
            <th scope="col" className={HEAD}>
              Links to
            </th>
          )}
        </tr>
      </thead>
      <tbody className="[&>tr:last-child>*]:border-b-0">
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row" className={`${ROW_HEAD} whitespace-nowrap`}>
              {fixedLabelOfRow(section.id, row.id)}
            </th>
            {section.columns.map((column) => (
              <td key={column.id} className={CELL}>
                {cellFor(props, row, column)}
              </td>
            ))}
            {section.links && <td className={CELL}>{linkFor(props, row)}</td>}
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

function TransposedTable(props: SectionBodyProps) {
  const { section, rows, onApply, labelledBy } = props;
  return (
    <TableFrame labelledBy={labelledBy}>
      <thead>
        <tr>
          <td />
          {rows.map((row, i) => (
            <th key={row.id} scope="col" className="px-2 pt-2 text-left">
              <div className="min-w-44">
                <NumberedLabel text={`Policy ${i + 1}`} label={rowLabel(section, row)} />
              </div>
            </th>
          ))}
        </tr>
        <tr>
          <td className={HEAD} />
          {rows.map((row) => (
            <td key={row.id} className={HEAD}>
              <RowActions section={section} rows={rows} row={row} onApply={onApply} />
            </td>
          ))}
        </tr>
      </thead>
      <tbody className="[&>tr:last-child>*]:border-b-0">
        {section.links && (
          <tr>
            <th scope="row" className={ROW_HEAD}>
              Links to
            </th>
            {rows.map((row) => (
              <td key={row.id} className={CELL}>
                {linkFor(props, row)}
              </td>
            ))}
          </tr>
        )}
        {section.columns.map((column) => (
          <tr key={column.id}>
            <th scope="row" className={ROW_HEAD}>
              <div className="min-w-40">{column.label}</div>
            </th>
            {rows.map((row) => (
              <td key={row.id} className={CELL}>
                {cellFor(props, row, column)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

/** A notes section: its one fixed row's one text box. */
function NotesBox(props: SectionBodyProps) {
  const [row] = props.rows;
  if (!row) return null;
  return <div className="px-[var(--pad-card)] py-3">{cellFor(props, row, props.section.columns[0])}</div>;
}

export function SectionBody(props: SectionBodyProps) {
  switch (props.section.layout) {
    case "list":
      return <ListTable {...props} />;
    case "fixedRows":
      return <FixedRowsTable {...props} />;
    case "transposed":
      return <TransposedTable {...props} />;
    case "notes":
      return <NotesBox {...props} />;
  }
}
