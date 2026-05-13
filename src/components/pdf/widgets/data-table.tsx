// src/components/reports-pdf/widgets/data-table.tsx
//
// Generalized table widget for PDF reports. Handles a header row, body rows,
// and an optional footer row. NOT for nested/rowspan tables — those keep their
// bespoke renderers (e.g. the estate-transfer table).

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";

export type DataTableColumn<TRow> = {
  header: string;
  accessor: (row: TRow) => string;
  align?: "left" | "right";
  width?: string | number;
};

export type DataTableProps<TRow> = {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  footerRow?: TRow;
  /** Compact mode shrinks font + padding so wide tables (10+ columns) fit on
   *  portrait Letter without column headers wrapping into illegible stacks. */
  compact?: boolean;
};

const s = StyleSheet.create({
  table: { width: "100%", marginTop: 8 },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.ink,
    paddingVertical: 4,
  },
  headerRowCompact: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.ink,
    paddingVertical: 2,
  },
  bodyRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_THEME.hair,
    paddingVertical: 3,
  },
  bodyRowCompact: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_THEME.hair,
    paddingVertical: 1.5,
  },
  footerRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.ink,
    paddingVertical: 4,
  },
  footerRowCompact: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.ink,
    paddingVertical: 2,
  },
  cell: {
    fontSize: 10,
    color: PDF_THEME.ink,
    paddingHorizontal: 4,
  },
  cellCompact: {
    fontSize: 7,
    color: PDF_THEME.ink,
    paddingHorizontal: 2,
  },
  headerCell: {
    fontSize: 10,
    fontWeight: 700,
    color: PDF_THEME.ink2,
    paddingHorizontal: 4,
  },
  headerCellCompact: {
    fontSize: 7,
    fontWeight: 700,
    color: PDF_THEME.ink2,
    paddingHorizontal: 2,
  },
});

export function DataTable<TRow>({ columns, rows, footerRow, compact }: DataTableProps<TRow>) {
  const headerRowStyle = compact ? s.headerRowCompact : s.headerRow;
  const bodyRowStyle = compact ? s.bodyRowCompact : s.bodyRow;
  const footerRowStyle = compact ? s.footerRowCompact : s.footerRow;
  const cellStyle = compact ? s.cellCompact : s.cell;
  const headerCellStyle = compact ? s.headerCellCompact : s.headerCell;
  const cellWidth = (c: DataTableColumn<TRow>) =>
    c.width ?? `${100 / columns.length}%`;

  return (
    <View style={s.table}>
      {/* Header row */}
      <View style={headerRowStyle}>
        {columns.map((c, i) => (
          <Text
            key={i}
            style={[headerCellStyle, { width: cellWidth(c), textAlign: c.align ?? "left" }]}
          >
            {c.header}
          </Text>
        ))}
      </View>

      {/* Body rows */}
      {rows.map((row, ri) => (
        <View key={ri} style={bodyRowStyle}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[cellStyle, { width: cellWidth(c), textAlign: c.align ?? "left" }]}
            >
              {c.accessor(row)}
            </Text>
          ))}
        </View>
      ))}

      {/* Optional footer row (bold, top-bordered) */}
      {footerRow && (
        <View style={footerRowStyle}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[headerCellStyle, { width: cellWidth(c), textAlign: c.align ?? "left" }]}
            >
              {c.accessor(footerRow)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
