// src/components/intake-answers-pdf/intake-answers-pdf-document.tsx
//
// A submitted data-collection form as a downloadable PDF, dressed in the client
// presentation deck's chrome — the same cover, page frame, section head and
// table styling as the Client Profile page — so it sits beside a printed plan
// as one family. The content is the client's answers, built by
// `buildIntakeAnswersDocument`; this file only prints its blocks.
import type { ReactNode } from "react";
import { Document, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { CoverPdf } from "@/components/presentations/pages/cover/page-pdf";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT, PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type {
  AnswerBlock,
  AnswerColumn,
  AnswerSection,
  AnswerTableRow,
  IntakeAnswersDocument,
} from "@/lib/intake/answers-document";

export interface IntakeAnswersPdfProps {
  doc: IntakeAnswersDocument;
  firmName: string;
  /** Firm logo, or the Foundry default the route falls back to. */
  logoDataUrl: string | null;
  /** Firm primary color — the cover's stripes and rules. */
  accentColor: string;
}

const TITLE = "Data Collection";
const DISCLAIMER = "Answers as provided by the client. Figures have not been independently verified.";

const s = StyleSheet.create({
  // Submission strip under the head.
  meta: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: T.card,
    borderWidth: 0.5,
    borderColor: T.hair2,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  metaLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: T.ink3,
    marginBottom: 2,
  },
  metaValue: { fontFamily: "Inter", fontSize: 9, color: T.ink },

  sectionLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: T.accent,
    marginTop: 16,
    marginBottom: 6,
  },
  blockHeading: {
    fontFamily: "Inter",
    fontSize: 8.5,
    fontWeight: 600,
    color: T.ink,
    marginTop: 8,
    marginBottom: 4,
  },
  gap: { marginTop: 8 },

  // People cards — the Client Profile page's person card.
  personRow: { flexDirection: "row", gap: 12 },
  personCard: {
    flex: 1,
    backgroundColor: T.card,
    borderWidth: 0.5,
    borderColor: T.hair2,
    borderRadius: 4,
    padding: 12,
  },
  personRole: {
    fontFamily: "JetBrains Mono",
    fontSize: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: T.ink3,
    marginBottom: 2,
  },
  personName: { fontFamily: "Fraunces", fontSize: 14, fontWeight: 600, color: T.ink, marginBottom: 6 },

  // Label / value rows.
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair,
  },
  cardFieldRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 3 },
  fieldLabel: { fontFamily: "Inter", fontSize: 8.5, color: T.ink3, flexShrink: 0, maxWidth: "45%" },
  fieldValue: { fontFamily: "Inter", fontSize: 9, color: T.ink, flex: 1, textAlign: "right" },
  fieldValueStacked: { fontFamily: "Inter", fontSize: 9, color: T.ink, marginTop: 2, lineHeight: 1.4 },

  // Tables — the Client Profile page's table.
  headerRow: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderBottomColor: T.accent,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  dataRow: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
    paddingVertical: 3.5,
    paddingHorizontal: 4,
  },
  totalRow: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: T.hair2,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  cells: { flexDirection: "row", gap: 6 },
  th: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 700, color: T.ink },
  td: { fontFamily: "Inter", fontSize: 8.5, color: T.ink2 },
  tdStrong: { fontFamily: "Inter", fontSize: 8.5, fontWeight: 700, color: T.ink },
  rowNote: { fontFamily: "Inter", fontSize: 7.5, color: T.ink3, marginTop: 2 },
  right: { textAlign: "right" },

  listRow: { flexDirection: "row", marginBottom: 3 },
  bullet: { fontFamily: "Inter", fontSize: 9, color: T.ink3, width: 12 },
  listText: { fontFamily: "Inter", fontSize: 9, color: T.ink, flex: 1 },

  quote: {
    borderLeftWidth: 1.5,
    borderLeftColor: T.hair2,
    paddingLeft: 8,
    paddingVertical: 2,
    fontFamily: "Inter",
    fontStyle: "italic",
    fontSize: 9,
    lineHeight: 1.45,
    color: T.ink2,
  },
  empty: { fontFamily: "Inter", fontSize: 9, color: T.ink3 },
});

// ── Blocks ───────────────────────────────────────────────────────────────────
//
// Every block prints as a FLAT run of unbreakable rows — Fragments, never a
// wrapping View. The page frame's flow mode needs that: react-pdf keeps a
// container whose first row will not fit on the sheet it started on and
// squeezes it, so a table inside a View printed squashed at the foot of a page.
//
// `lead` is the section label, printed in the same unbreakable row as the
// block's first item. Neither `minPresenceAhead` nor a fixed header keeps a
// heading from stranding at the foot of a page; a row too tall to fit does.

/** The opening row of a block: section label, block heading, first item. A
 *  block with neither label nor heading takes a small gap instead, so two
 *  bare blocks (Risk's result, then its table) don't touch. */
function Opening({
  lead,
  heading,
  children,
}: {
  lead?: ReactNode;
  heading?: string;
  children: ReactNode;
}) {
  return (
    <View wrap={false} style={lead || heading ? undefined : s.gap}>
      {lead}
      {heading ? <Text style={s.blockHeading}>{heading}</Text> : null}
      {children}
    </View>
  );
}

function Cells({ columns, cells, style }: { columns: AnswerColumn[]; cells: string[]; style: Style }) {
  return (
    <View style={s.cells}>
      {columns.map((c, i) => (
        <Text key={i} style={[style, { flex: c.flex }, c.align === "right" ? s.right : {}]}>
          {cells[i]}
        </Text>
      ))}
    </View>
  );
}

function TableRow({ columns, row }: { columns: AnswerColumn[]; row: AnswerTableRow }) {
  return (
    <View style={s.dataRow}>
      <Cells columns={columns} cells={row.cells} style={s.td} />
      {row.note ? <Text style={s.rowNote}>{row.note}</Text> : null}
    </View>
  );
}

/** A table this short moves to the next sheet whole rather than leaving a
 *  row or two there with no column headings over them. */
const KEEP_TABLE_WHOLE = 10;

function TableBlock({ block, lead }: { block: Extract<AnswerBlock, { kind: "table" }>; lead?: ReactNode }) {
  // A short table opens with every row; a long one opens with its first and
  // flows the rest a row at a time. The total rides with the last row either way.
  const opening = block.rows.slice(0, block.rows.length <= KEEP_TABLE_WHOLE ? undefined : 1);
  const flowing = block.rows.slice(opening.length);
  const total = block.total && (
    <View style={s.totalRow}>
      <Cells columns={block.columns} cells={block.total} style={s.tdStrong} />
    </View>
  );
  const last = flowing.length - 1;
  return (
    <>
      <Opening lead={lead} heading={block.heading}>
        <View style={s.headerRow}>
          <Cells columns={block.columns} cells={block.columns.map((c) => c.label)} style={s.th} />
        </View>
        {opening.map((row, i) => (
          <TableRow key={i} columns={block.columns} row={row} />
        ))}
        {flowing.length === 0 && total}
      </Opening>
      {flowing.map((row, i) => (
        <View key={i} wrap={false}>
          <TableRow columns={block.columns} row={row} />
          {i === last && total}
        </View>
      ))}
    </>
  );
}

/** A value too long for one line beside its label prints under it instead —
 *  right-aligned, a wrapped sentence reads ragged on the left. */
const STACK_AT = 90;

function FieldRow({ label, value }: { label: string; value: string }) {
  if (value.length > STACK_AT) {
    return (
      <View style={s.fieldRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>{label}</Text>
          <Text style={s.fieldValueStacked}>{value}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}


function PeopleBlock({ block, lead }: { block: Extract<AnswerBlock, { kind: "people" }>; lead?: ReactNode }) {
  return (
    <Opening lead={lead}>
      <View style={s.personRow}>
        {block.people.map((p, i) => (
          <View key={i} style={s.personCard}>
            <Text style={s.personRole}>{p.role}</Text>
            <Text style={s.personName}>{p.name}</Text>
            {p.fields.map((f, j) => (
              <View key={j} style={s.cardFieldRow}>
                <Text style={s.fieldLabel}>{f.label}</Text>
                <Text style={s.fieldValue}>{f.value}</Text>
              </View>
            ))}
          </View>
        ))}
        {/* A lone card keeps the width it would have beside a co-client. */}
        {block.people.length === 1 && <View style={{ flex: 1 }} />}
      </View>
    </Opening>
  );
}

function ListItem({ text }: { text: string }) {
  return (
    <View style={s.listRow}>
      <Text style={s.bullet}>•</Text>
      <Text style={s.listText}>{text}</Text>
    </View>
  );
}


function Block({ block, lead }: { block: AnswerBlock; lead?: ReactNode }) {
  switch (block.kind) {
    case "table":
      return <TableBlock block={block} lead={lead} />;
    // Fields and lists are a handful of lines at most — each prints as one piece.
    case "fields":
      return (
        <Opening lead={lead} heading={block.heading}>
          {block.fields.map((f, i) => (
            <FieldRow key={i} {...f} />
          ))}
        </Opening>
      );
    case "people":
      return <PeopleBlock block={block} lead={lead} />;
    case "list":
      return (
        <Opening lead={lead} heading={block.heading}>
          {block.items.map((item, i) => (
            <ListItem key={i} text={item} />
          ))}
        </Opening>
      );
    case "quote":
      return (
        <Opening lead={lead} heading={block.heading}>
          <Text style={s.quote}>{block.text}</Text>
        </Opening>
      );
    case "empty":
      return (
        <Opening lead={lead}>
          <Text style={s.empty}>{block.text}</Text>
        </Opening>
      );
  }
}

function Section({ section }: { section: AnswerSection }) {
  const lead = <Text style={s.sectionLabel}>{section.title}</Text>;
  return (
    <>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} lead={i === 0 ? lead : undefined} />
      ))}
    </>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

// ── Document ─────────────────────────────────────────────────────────────────

export function IntakeAnswersPdfDocument({ doc, firmName, logoDataUrl, accentColor }: IntakeAnswersPdfProps) {
  ensureFontsRegistered();
  return (
    <Document title={`${TITLE} — ${doc.householdName}`} author={firmName}>
      <CoverPdf
        title={TITLE}
        firmName={firmName}
        firmTagline={null}
        clientName={doc.householdName}
        spouseName={null}
        scenarioLabel={null}
        reportDate={doc.submittedOn}
        logoDataUrl={logoDataUrl}
        accentColor={accentColor}
      />
      <PageFrame
        firmName={firmName}
        clientName={doc.householdName}
        reportDate={doc.submittedOn}
        pageIndex={1}
        totalPages={1}
        disclaimer={DISCLAIMER}
        flow
      >
        <SectionHead title={TITLE} subtitle={`Submitted ${doc.submittedOn}`} accent={DEFAULT_ACCENT} />
        <View style={s.meta}>
          <View style={{ flex: 2 }}>
            <Text style={s.metaLabel}>Completed by</Text>
            <Text style={s.metaValue}>{doc.completedBy}</Text>
          </View>
          {doc.sentOn && <MetaItem label="Sent" value={doc.sentOn} />}
          <MetaItem label="Submitted" value={doc.submittedOn} />
        </View>
        {doc.sections.map((section) => (
          <Section key={section.key} section={section} />
        ))}
      </PageFrame>
    </Document>
  );
}
