// src/components/comparison-pdf/widgets/text.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange, TextWidgetConfig } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import { PDF_THEME } from "@/components/pdf/theme";

const s = StyleSheet.create({
  wrap: { padding: 6 },
  para: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.5, color: PDF_THEME.ink, marginBottom: 6 },
  empty: { fontFamily: "JetBrains Mono", fontSize: 9, color: PDF_THEME.ink3 },
});

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%", 2: "40%", 3: "60%", 4: "80%", 5: "100%",
};

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

export function TextPdf({ config, span }: Props) {
  const cfg = (config ?? {}) as Partial<TextWidgetConfig>;
  const md = (cfg.markdown ?? "").trim();
  if (md === "") {
    return (
      <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
        <Text style={s.empty}>(no text)</Text>
      </View>
    );
  }
  const paragraphs = md.split(/\n\s*\n/).map((p) => p.replace(/\s+\n/g, " ").trim()).filter(Boolean);
  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {paragraphs.map((p, i) => (
        <Text key={i} style={s.para}>{stripMarkdown(p)}</Text>
      ))}
    </View>
  );
}

function stripMarkdown(p: string): string {
  // Conservative inline strip: **bold**, *italics*, `code`, [text](url) → text.
  return p
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}
