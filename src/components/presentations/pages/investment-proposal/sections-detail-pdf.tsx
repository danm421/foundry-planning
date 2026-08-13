// The evidence behind the verdict. Each section owns one sheet.
//
// Two rules run through all six: a number the snapshot does not have prints as
// an em-dash, never a zero; and the tax cost never appears without the
// break-even beside it — a page that lists only the benefits is the one that
// gets an advisor in trouble.
import { View, Text } from "@react-pdf/renderer";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { Callout } from "@/components/presentations/shared/callout";
import { Frame, S, usd, pct1, pct2, type SectionProps } from "./sections-overview-pdf";

export function GrowthSection({ data, frame, accent }: SectionProps) {
  const b = data.snapshot?.backtest ?? null;
  return (
    <Frame frame={frame}>
      <SectionHead
        title="Growth of $100,000"
        subtitle={b ? `${b.windowStart} – ${b.windowEnd}` : "Not available"}
        accent={accent}
      />
      {b === null ? (
        <Callout accent={accent}>
          The two portfolios share too little price history to compare a realized growth path.
        </Callout>
      ) : (
        <>
          <View style={S.row}>
            <Text style={[S.headCell, { flex: 2 }]}>Portfolio</Text>
            <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Started at</Text>
            <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Ended at</Text>
          </View>
          <View style={S.row}>
            <Text style={S.rowName}>Current</Text>
            <Text style={S.rowNum}>{usd(b.startValue)}</Text>
            <Text style={S.rowNum}>{usd(b.endingCurrent)}</Text>
          </View>
          <View style={S.row}>
            <Text style={S.rowName}>Proposed</Text>
            <Text style={S.rowNum}>{usd(b.startValue)}</Text>
            <Text style={S.rowNum}>{usd(b.endingProposed)}</Text>
          </View>
          <Text style={S.note}>
            {`Past performance of the underlying asset classes over ${b.nMonths} months. Not a forecast.`}
          </Text>
        </>
      )}
    </Frame>
  );
}

export function StressSection({ data, frame, accent }: SectionProps) {
  return (
    <Frame frame={frame}>
      <SectionHead
        title="Stress test"
        subtitle="How each portfolio behaved in past declines"
        accent={accent}
      />
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 2 }]}>Window</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Current</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Proposed</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Current $</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Proposed $</Text>
      </View>
      {data.stress.available.map((w) => (
        <View key={w.key} style={S.row}>
          <Text style={S.rowName}>{`${w.label} (${w.start} – ${w.end})`}</Text>
          <Text style={S.rowNum}>{pct1(w.currentReturn)}</Text>
          <Text style={S.rowNum}>{pct1(w.proposedReturn)}</Text>
          <Text style={S.rowNum}>{usd(w.currentDollars)}</Text>
          <Text style={S.rowNum}>{usd(w.proposedDollars)}</Text>
        </View>
      ))}
      {/* A window that silently vanished reads as "no loss". Name it and say why. */}
      {data.stress.unavailable.map((u) => (
        <Text key={u.label} style={S.note}>{`${u.label}: ${u.reason}`}</Text>
      ))}
    </Frame>
  );
}

export function OutcomesSection({ data, frame, accent }: SectionProps) {
  const o = data.snapshot?.outcomes;
  return (
    <Frame frame={frame}>
      <SectionHead title="Range of outcomes" subtitle="Portfolio only" accent={accent} />
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 2 }]}>Horizon</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Poor (10th)</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Middle (50th)</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Strong (90th)</Text>
      </View>
      {(o?.proposed ?? []).map((r) => (
        <View key={`proposed-${r.years}`} style={S.row}>
          <Text style={S.rowName}>{`Proposed, ${r.years} years`}</Text>
          <Text style={S.rowNum}>{usd(r.p10)}</Text>
          <Text style={S.rowNum}>{usd(r.p50)}</Text>
          <Text style={S.rowNum}>{usd(r.p90)}</Text>
        </View>
      ))}
      {(o?.current ?? []).map((r) => (
        <View key={`current-${r.years}`} style={S.row}>
          <Text style={S.rowName}>{`Current, ${r.years} years`}</Text>
          <Text style={S.rowNum}>{usd(r.p10)}</Text>
          <Text style={S.rowNum}>{usd(r.p50)}</Text>
          <Text style={S.rowNum}>{usd(r.p90)}</Text>
        </View>
      ))}
      <View style={{ marginTop: 12 }}>
        <Callout accent={accent}>
          Portfolio growth only — this is not the plan&apos;s probability of success. No contributions,
          withdrawals, or goals are modelled here.
        </Callout>
      </View>
    </Frame>
  );
}

export function FeesSection({ data, frame, accent }: SectionProps) {
  const f = data.snapshot?.fees;
  const saved = f?.annualDollarsSaved ?? null;
  return (
    <Frame frame={frame}>
      <SectionHead title="Fees" subtitle="What each portfolio costs to hold" accent={accent} />
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 2 }]}>Cost</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Current</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Proposed</Text>
      </View>
      <View style={S.row}>
        <Text style={S.rowName}>Fund expense ratio (blended)</Text>
        <Text style={S.rowNum}>{pct2(f?.currentBlendedEr ?? null)}</Text>
        <Text style={S.rowNum}>{pct2(f?.proposedBlendedEr ?? null)}</Text>
      </View>
      <View style={S.row}>
        <Text style={S.rowName}>Advisory fee</Text>
        <Text style={S.rowNum}>{pct2(f?.advisoryFeeCurrent ?? null)}</Text>
        <Text style={S.rowNum}>{pct2(f?.advisoryFeeProposed ?? null)}</Text>
      </View>
      <View style={S.row}>
        <Text style={S.rowName}>All-in cost, per year</Text>
        <Text style={S.rowNum}>{usd(f?.annualDollarsCurrent ?? null)}</Text>
        <Text style={S.rowNum}>{usd(f?.annualDollarsProposed ?? null)}</Text>
      </View>
      {/* Coverage below 50% means the blend is guesswork; say so instead of
          printing a confident number over half-missing fee data. */}
      {(f?.proposedCoveragePct ?? 1) < 0.5 && (
        <View style={{ marginTop: 12 }}>
          <Callout accent={accent}>
            {`Fund costs are known for only ${Math.round((f?.proposedCoveragePct ?? 0) * 100)}% of the proposed holdings' value. Treat the blended figure as indicative.`}
          </Callout>
        </View>
      )}
      {saved !== null && (
        <Text style={S.note}>
          {saved >= 0
            ? `The proposal costs ${usd(saved)} less per year.`
            : `The proposal costs ${usd(Math.abs(saved))} more per year.`}
        </Text>
      )}
    </Frame>
  );
}

export function TransitionSection({ data, frame, accent }: SectionProps) {
  const c = data.snapshot?.compute;
  const be = data.snapshot?.breakEven;
  return (
    <Frame frame={frame}>
      <SectionHead title="Transition &amp; tax" subtitle="What it takes to get there" accent={accent} />
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 2 }]}>Asset class</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Today</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Proposed</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Trade</Text>
      </View>
      {(c?.tradeSummary ?? []).map((t) => (
        <View key={t.assetClassId} style={S.row}>
          <Text style={S.rowName}>{t.name}</Text>
          <Text style={S.rowNum}>{usd(t.currentValue)}</Text>
          <Text style={S.rowNum}>{usd(t.targetValue)}</Text>
          <Text style={S.rowNum}>{`${t.deltaValue >= 0 ? "BUY " : "SELL "}${usd(Math.abs(t.deltaValue))}`}</Text>
        </View>
      ))}
      <View style={{ marginTop: 12 }}>
        <Callout accent={accent}>
          {`Estimated tax to switch: ${usd(c?.tax.estimatedTax ?? null)} on ${usd(c?.tax.realizedGain ?? null)} of realized gain. ${data.verdict.headline}`}
        </Callout>
      </View>
      {be?.verdict === "recovered" && (
        <Text style={S.note}>
          {`Break-even in about ${be.years!.toFixed(1)} years at the modelled annual benefit of ${usd(be.annualBenefit)}.`}
        </Text>
      )}
    </Frame>
  );
}

export function HoldingsSection({ data, frame, accent }: SectionProps) {
  return (
    <Frame frame={frame}>
      <SectionHead title="Holdings &amp; disclosures" subtitle="The proposed portfolio" accent={accent} />
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 1 }]}>Ticker</Text>
        <Text style={[S.headCell, { flex: 3 }]}>Name</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Weight</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Expense ratio</Text>
      </View>
      {(data.snapshot?.targetHoldings ?? []).map((h) => (
        <View key={h.ticker} style={S.row}>
          <Text style={[S.rowName, { flex: 1 }]}>{h.ticker}</Text>
          <Text style={[S.rowName, { flex: 3 }]}>{h.name ?? "—"}</Text>
          <Text style={S.rowNum}>{pct1(h.weight)}</Text>
          <Text style={S.rowNum}>{pct2(h.expenseRatio)}</Text>
        </View>
      ))}
      <Text style={S.note}>
        {`Figures are as of ${data.asOf.slice(0, 10)} and do not update. Expected returns are capital-market assumptions, not forecasts. Past performance does not guarantee future results.`}
      </Text>
    </Frame>
  );
}
