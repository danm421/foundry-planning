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
};

const s = StyleSheet.create({
  table: { width: "100%", marginTop: 8 },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.ink,
    paddingVertical: 4,
  },
  bodyRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_THEME.hair,
    paddingVertical: 3,
  },
  footerRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.ink,
    paddingVertical: 4,
  },
  cell: {
    fontSize: 10,
    color: PDF_THEME.ink,
    paddingHorizontal: 4,
  },
  headerCell: {
    fontSize: 10,
    fontWeight: 700,
    color: PDF_THEME.ink2,
    paddingHorizontal: 4,
  },
});

export function DataTable<TRow>({ columns, rows, footerRow }: DataTableProps<TRow>) {
  const cellWidth = (c: DataTableColumn<TRow>) =>
    c.width ?? `${100 / columns.length}%`;

  return (
    <View style={s.table}>
      {/* Header row */}
      <View style={s.headerRow}>
        {columns.map((c, i) => (
          <Text
            key={i}
            style={[s.headerCell, { width: cellWidth(c), textAlign: c.align ?? "left" }]}
          >
            {c.header}
          </Text>
        ))}
      </View>

      {/* Body rows */}
      {rows.map((row, ri) => (
        <View key={ri} style={s.bodyRow}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[s.cell, { width: cellWidth(c), textAlign: c.align ?? "left" }]}
            >
              {c.accessor(row)}
            </Text>
          ))}
        </View>
      ))}

      {/* Optional footer row (bold, top-bordered) */}
      {footerRow && (
        <View style={s.footerRow}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[s.headerCell, { width: cellWidth(c), textAlign: c.align ?? "left" }]}
            >
              {c.accessor(footerRow)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
