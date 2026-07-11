import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { MarkdownPdf } from "@/components/presentations/pages/blank/markdown-pdf";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { ObservationsPageData } from "@/lib/presentations/pages/observations-next-steps/view-model";
import type { RenderPdfInput } from "@/components/presentations/registry";

type NextStep = ObservationsPageData["nextSteps"][number];
type TopicGroup = ObservationsPageData["topicGroups"][number];

const STATUS_GLYPH: Record<NextStep["status"], string> = {
  open: "○",
  in_progress: "◐",
  done: "●",
};

const s = StyleSheet.create({
  sectionTitle: {
    fontFamily: "JetBrains Mono",
    fontSize: 10,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 6,
  },
  topicLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: PRESENTATION_THEME.ink3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 4,
  },
  bulletRow: { flexDirection: "row", marginBottom: 4 },
  bullet: { fontFamily: "Inter", fontSize: 10, color: PRESENTATION_THEME.ink, width: 14 },
  bulletBody: { flex: 1 },
  stepRow: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: PRESENTATION_THEME.hair,
  },
  stepHeader: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  glyph: { fontFamily: "Inter", fontSize: 10, color: PRESENTATION_THEME.ink, width: 14 },
  priorityDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: PRESENTATION_THEME.accent,
    marginRight: 5,
  },
  titleWrap: { flex: 1 },
  title: { fontFamily: "Inter", fontSize: 10.5, fontWeight: 700, color: PRESENTATION_THEME.ink },
  meta: { fontFamily: "JetBrains Mono", fontSize: 7.5, color: PRESENTATION_THEME.ink3 },
});

function ObservationTopicGroup({ group }: { group: TopicGroup }) {
  return (
    <View>
      <Text style={s.topicLabel}>{group.label}</Text>
      {group.items.map((blocks, i) => (
        <View key={i} style={s.bulletRow}>
          <Text style={s.bullet}>•</Text>
          <View style={s.bulletBody}>
            <MarkdownPdf blocks={blocks} />
          </View>
        </View>
      ))}
    </View>
  );
}

function NextStepRow({ step, showOwnerAndDate }: { step: NextStep; showOwnerAndDate: boolean }) {
  const done = step.status === "done";
  const metaLabel =
    showOwnerAndDate && (step.ownerLabel || step.dateLabel)
      ? [step.ownerLabel, step.dateLabel].filter(Boolean).join(" · ")
      : null;
  return (
    // `opacity` on the wrapping View cascades to every descendant (react-pdf
    // supports it as an inherited style), which is the only way to mute a
    // "done" row without threading a color override through MarkdownPdf —
    // its block styles set explicit colors that would otherwise win over an
    // inherited `color`.
    <View style={done ? [s.stepRow, { opacity: 0.55 }] : s.stepRow} wrap={false}>
      <View style={s.stepHeader}>
        <Text style={s.glyph}>{STATUS_GLYPH[step.status]}</Text>
        {step.priority === "high" && <View style={s.priorityDot} />}
        <View style={s.titleWrap}>
          {step.title ? <Text style={s.title}>{step.title}</Text> : null}
        </View>
        {metaLabel ? <Text style={s.meta}>{metaLabel}</Text> : null}
      </View>
      <MarkdownPdf blocks={step.bodyBlocks} />
    </View>
  );
}

export function ObservationsNextStepsPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
}: RenderPdfInput<ObservationsPageData>) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <MarkdownPdf blocks={data.introBlocks} />

      {data.topicGroups.length > 0 && (
        <View>
          <Text style={s.sectionTitle}>Observations</Text>
          {data.topicGroups.map((group) => (
            <ObservationTopicGroup key={group.topic} group={group} />
          ))}
        </View>
      )}

      {data.nextSteps.length > 0 && (
        <View>
          <Text style={s.sectionTitle}>Next Steps</Text>
          {data.nextSteps.map((step, i) => (
            <NextStepRow key={i} step={step} showOwnerAndDate={data.showOwnerAndDate} />
          ))}
        </View>
      )}
    </PageFrame>
  );
}
