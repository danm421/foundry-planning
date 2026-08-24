import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { ReactNode } from "react";

export interface DetailTableColumn<Row> {
  header: string;
  flex: number;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
}

const s = StyleSheet.create({
  table: { marginTop: 10 },
  caption: { fontSize: 6.5, color: T.ink3, marginBottom: 4 },
  header: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: T.hair,
    paddingBottom: 3,
  },
  headerText: {
    fontSize: 6,
    color: T.ink2,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
    paddingVertical: 2.25,
  },
  cell: { paddingRight: 5, justifyContent: "center" },
});

/** The caption line above a table. Exported because the Roth sheet's summary
 *  matrix is hand-rolled rather than a `DetailTablePdf`, and two copies of one
 *  caption style drift apart the first time it is retuned. */
export function TableCaptionPdf({ children }: { children: string }) {
  return <Text style={s.caption}>{children}</Text>;
}

export function DetailTablePdf<Row>({
  rows,
  columns,
  rowKey,
  caption,
  marginTop = 10,
  rowPaddingVertical = 2.25,
}: {
  rows: Row[];
  columns: DetailTableColumn<Row>[];
  rowKey: (row: Row) => string;
  /** Names the quantity and its units ONCE, above the table. The cells then
   *  hold digits only — see `DualDollarValuePdf`. */
  caption?: string;
  marginTop?: number;
  rowPaddingVertical?: number;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={[s.table, { marginTop }]}>
      {caption != null && <TableCaptionPdf>{caption}</TableCaptionPdf>}
      <View style={s.header} wrap={false}>
        {columns.map((column, index) => (
          <View
            key={index}
            style={[
              s.cell,
              {
                flex: column.flex,
                alignItems: column.align === "right" ? "flex-end" : "flex-start",
              },
            ]}
          >
            <Text style={[s.headerText, { textAlign: column.align ?? "left" }]}>
              {column.header}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row) => (
        <View
          key={rowKey(row)}
          style={[s.row, { paddingVertical: rowPaddingVertical }]}
          wrap={false}
        >
          {columns.map((column, index) => (
            <View
              key={index}
              style={[
                s.cell,
                {
                  flex: column.flex,
                  alignItems: column.align === "right" ? "flex-end" : "flex-start",
                },
              ]}
            >
              {column.render(row)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
