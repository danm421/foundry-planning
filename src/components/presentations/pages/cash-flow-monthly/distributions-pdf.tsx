// The Distributions branch of the Monthly Cash Flow sheet: a two-column year
// card (layout A of the approved screen), the chart, then the across-the-plan
// table. Which card lines show and their wording come from
// `distributionCardLines`, the screen panel's own source, and every figure is
// a `DistributionRow` field; nothing is recomputed here.
//
// Colour is never the only carrier: the spending box has a thick teal left
// rule, the taxes box a thick orange one, and the goals box a dashed violet
// border plus its own heading, so the three still separate on a greyscale page.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, type SectionAccent } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import {
  DEPLETED_GLYPH,
  otherAccountsAmount,
} from "@/lib/presentations/pages/cash-flow-monthly/view-model";
import type { MonthlyCashFlowPageData } from "@/lib/presentations/pages/cash-flow-monthly/types";
import type { DistributionRow } from "@/lib/solver/monthly-distributions";
import {
  NOT_ACCOUNTED_FOR,
  distributionCardLines,
  money,
  moneyOrDash,
  signedMoney,
} from "@/lib/solver/distribution-card-lines";

type Distribution = NonNullable<MonthlyCashFlowPageData["distribution"]>;

const s = StyleSheet.create({
  card: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  head: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 4 },
  year: { fontSize: 11, fontWeight: 700, color: T.ink },
  ages: { fontSize: 8, color: T.ink3 },
  cols: { flexDirection: "row", gap: 8 },
  col: { flex: 1, gap: 5 },
  box: {
    borderWidth: 0.75,
    borderColor: T.hair2,
    borderRadius: 2,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: T.card,
  },
  eyebrow: {
    fontSize: 6.5,
    fontWeight: 700,
    color: T.ink2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  hero: { fontSize: 18, fontWeight: 700, color: T.ink },
  sub: { fontSize: 7, color: T.ink3, lineHeight: 1.3 },
  rule: { borderTopWidth: 0.5, borderTopColor: T.hair, marginVertical: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  rowLbl: { fontSize: 8, color: T.ink2, flex: 1, paddingRight: 6 },
  rowVal: { fontSize: 8, fontWeight: 600, color: T.ink },
  indent: { paddingLeft: 8 },
  banner: {
    marginBottom: 5,
    borderWidth: 1,
    borderColor: T.crit,
    borderRadius: 2,
    paddingVertical: 3,
    paddingHorizontal: 5,
    fontSize: 7.5,
    color: T.crit,
  },
  table: { marginTop: 10 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: T.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dataRow: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  th: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 600, color: T.ink, paddingHorizontal: 1 },
  td: { fontFamily: "Inter", fontSize: 6.5, color: T.ink2, paddingHorizontal: 1 },
  tdStrong: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 600, color: T.ink, paddingHorizontal: 1 },
  right: { textAlign: "right" },
  left: { textAlign: "left" },
});

const ZEBRA = "#faf6ea";
const YEAR_W = 40;
const AGES_W = 46;
const cell = { flex: 1 } as const;

export function DistributionsTable({
  distribution,
  accent,
}: {
  distribution: Distribution;
  accent: SectionAccent;
}) {
  const { rows, columns, showOther } = distribution;
  const labels = [
    "Year",
    "Ages",
    "Spending\nneed",
    "Income",
    "Taxes",
    "From\naccounts",
    ...columns.map((c) => c.name),
    ...(showOther ? ["Other\naccounts"] : []),
    "Goals\n(set-aside)",
  ];
  return (
    // A FLAT run of rows (no wrapper View): the caller puts it in a `flow`
    // PageFrame, which is what lets react-pdf break it onto further sheets.
    <>
      <View
        style={[s.headerRow, { backgroundColor: accent.tint, borderBottomColor: accent.accent }]}
        fixed
      >
        {labels.map((l, i) => (
          <Text
            key={`${l}-${i}`}
            style={[
              s.th,
              i === 0 ? { width: YEAR_W } : i === 1 ? { width: AGES_W } : cell,
              i < 2 ? s.left : s.right,
            ]}
          >
            {l}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => {
        const byId = new Map(r.fromAccounts.accounts.map((a) => [a.accountId, a.amount]));
        return (
          <View key={r.year} style={[s.dataRow, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
            <Text style={[s.td, { width: YEAR_W }, s.left]}>
              {/* Shape, not colour: the flag has to survive a greyscale print. */}
              {r.depleted ? `${r.year} ${DEPLETED_GLYPH}` : String(r.year)}
            </Text>
            <Text style={[s.td, { width: AGES_W }, s.left]}>{r.ageLabel.replace(/^Age /, "")}</Text>
            <Text style={[s.td, cell, s.right]}>{money(r.need.total)}</Text>
            <Text style={[s.td, cell, s.right]}>{money(r.income.total)}</Text>
            <Text style={[s.td, cell, s.right]}>{money(r.taxes)}</Text>
            <Text style={[s.tdStrong, cell, s.right]}>{money(r.fromAccounts.total)}</Text>
            {columns.map((c) => (
              <Text key={c.accountId} style={[s.td, cell, s.right]}>
                {moneyOrDash(byId.get(c.accountId))}
              </Text>
            ))}
            {showOther && (
              <Text style={[s.td, cell, s.right]}>{moneyOrDash(otherAccountsAmount(r, columns))}</Text>
            )}
            <Text style={[s.td, cell, s.right]}>
              {moneyOrDash(r.goals.reduce((sum, g) => sum + g.fromSetAside, 0))}
            </Text>
          </View>
        );
      })}
    </>
  );
}

function Row({
  label,
  amount,
  indent,
  strong,
  muted,
  crit,
}: {
  label: string;
  amount: string;
  indent?: boolean;
  strong?: boolean;
  muted?: boolean;
  crit?: boolean;
}) {
  const color = crit ? T.crit : muted ? T.ink3 : T.ink;
  return (
    <View style={[s.row, indent ? s.indent : {}]}>
      <Text style={[s.rowLbl, strong ? { fontWeight: 700, color } : { color: crit ? T.crit : T.ink2 }]}>
        {label}
      </Text>
      <Text style={[s.rowVal, { color, fontWeight: strong ? 700 : 600 }]}>{amount}</Text>
    </View>
  );
}

export function DistributionsCard({ row: r }: { row: DistributionRow }) {
  const { need, fromAccounts: from } = r;
  const card = distributionCardLines(r);

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.year}>{String(r.year)}</Text>
        <Text style={s.ages}>{r.ageLabel}</Text>
      </View>

      {card.depletedBanner && <Text style={s.banner}>{card.depletedBanner}</Text>}
      {card.lifeInsuranceNote && (
        <Text style={[s.sub, { marginBottom: 4 }]}>{card.lifeInsuranceNote}</Text>
      )}

      <View style={s.cols}>
        <View style={s.col}>
          <View style={[s.box, { borderLeftWidth: 3, borderLeftColor: dataLight.teal }]}>
            <Text style={s.eyebrow}>Monthly spending need</Text>
            <Text style={s.hero}>{money(need.total)}</Text>
            <Text style={s.sub}>Before taxes · not counting goals paid from set-aside accounts</Text>
            <View style={s.rule} />
            {card.needLines.map((l) => (
              <Row key={l.label} label={l.label} amount={money(l.amount)} indent />
            ))}
            <View style={s.rule} />
            <Row
              label={[card.coveredByIncome.label, card.coveredByIncome.sources].filter(Boolean).join(" ")}
              amount={`−${money(r.income.total)}`}
            />
            <Row label="From accounts for spending" amount={money(from.parts.spending)} strong />
          </View>
          <View style={[s.box, { borderLeftWidth: 3, borderLeftColor: dataLight.orange }]}>
            <Row label="+ Taxes (paid separately)" amount={money(r.taxes)} strong />
            <Text style={s.sub}>Federal + state, spread evenly across the year</Text>
          </View>
        </View>

        <View style={s.col}>
          <View style={s.box}>
            <Text style={s.eyebrow}>Total from accounts each month</Text>
            <Text style={s.hero}>{`${money(from.total)}${r.depleted ? ` ${DEPLETED_GLYPH}` : ""}`}</Text>
            <Text style={s.sub}>{card.madeOfText}</Text>
            {card.unexplained != null && (
              <Row label={NOT_ACCOUNTED_FOR} amount={signedMoney(card.unexplained)} crit />
            )}
            <View style={s.rule} />
            {card.accounts.map((a) => (
              <Row
                key={a.accountId}
                label={a.note ? `${a.name} ${a.note}` : a.name}
                amount={money(a.amount)}
              />
            ))}
            {card.qcdNotes.map((note) => (
              <Text key={note} style={[s.sub, { marginTop: 2 }]}>
                {note}
              </Text>
            ))}
          </View>

          {card.goals.length > 0 && (
            <View
              style={[
                s.box,
                { borderStyle: "dashed", borderColor: dataLight.purple, borderLeftWidth: 3 },
              ]}
            >
              <Text style={s.eyebrow}>Goals — paid from set-aside accounts</Text>
              <Text style={[s.sub, { marginBottom: 2 }]}>{card.goalsCaption}</Text>
              {card.goals.map((g) => (
                <View key={g.goalId}>
                  <Row
                    label={g.from ? `${g.name} ${g.from}` : g.name}
                    amount={g.amount == null ? "" : money(g.amount)}
                  />
                  {g.fromGeneral && (
                    <Row label={g.fromGeneral.label} amount={money(g.fromGeneral.amount)} indent muted />
                  )}
                  {g.shortBy && <Row label={g.shortBy} amount="" indent crit />}
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
