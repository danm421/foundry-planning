// src/components/comparison-pdf/group-page.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { CellV5 } from "@/lib/comparison/layout-schema";
import { PDF_THEME } from "@/components/pdf/theme";
import { CellRender, type CellRenderCtx } from "./cell-render";

const s = StyleSheet.create({
  header: { marginBottom: 6 },
  title: {
    fontFamily: "Fraunces",
    fontSize: 14,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  rule: {
    marginTop: 6,
    marginBottom: 10,
    height: 1.5,
    width: 60,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
  },
});

export function GroupPage({
  groupTitle,
  continued,
  cells,
  ctx,
}: {
  groupTitle: string;
  continued: boolean;
  cells: CellV5[];
  ctx: CellRenderCtx;
}) {
  return (
    <View>
      <View style={s.header}>
        <Text style={s.title}>
          {groupTitle.trim() || "Section"}
          {continued ? "  (continued)" : ""}
        </Text>
        <View style={{ ...s.rule, backgroundColor: ctx.branding.primaryColor }} />
      </View>
      <View style={s.row}>
        {cells.map((c) => (
          <CellRender key={c.id} cell={c} ctx={ctx} />
        ))}
      </View>
    </View>
  );
}
