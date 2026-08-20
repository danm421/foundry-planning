import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  DebtOrInvestArm,
  EarlyYearsDebtOrInvestPageData,
} from "@/lib/presentations/pages/early-years-debt-or-invest/types";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 12 },
  cols: { flexDirection: "row", gap: 14 },
  main: { flex: 1 },
  lede: { fontSize: 9, color: T.ink, lineHeight: 1.35, marginBottom: 10 },
  arms: { flexDirection: "row", gap: 10 },
  arm: {
    flex: 1,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderTopWidth: 3,
    borderRadius: 3,
    padding: 9,
  },
  armTitle: { fontSize: 9.5, fontWeight: 700, color: T.ink, marginBottom: 6 },
  figLbl: {
    fontSize: 6.5,
    color: T.ink2,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 6,
  },
  figVal: { fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 1 },
  takeaway: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderLeftWidth: 3,
    borderRadius: 3,
    padding: 8,
    marginTop: 12,
  },
  takeawayText: { fontSize: 9, color: T.ink, lineHeight: 1.35 },
  footnote: { fontSize: 7, color: T.ink3, lineHeight: 1.35, marginTop: 8 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

function Arm({
  arm,
  milestoneAge,
  accent,
}: {
  arm: DebtOrInvestArm;
  milestoneAge: number;
  accent: string;
}) {
  return (
    <View style={[s.arm, { borderTopColor: accent }]}>
      <Text style={s.armTitle}>{arm.label}</Text>
      <Text style={s.figLbl}>Debt-free in</Text>
      <Text style={s.figVal}>{String(arm.debtFreeYear)}</Text>
      <Text style={s.figLbl}>Interest paid on this loan</Text>
      <Text style={s.figVal}>{exactCurrency(arm.interestPaid)}</Text>
      <Text style={s.figLbl}>{`Portfolio at ${milestoneAge}`}</Text>
      <Text style={s.figVal}>{exactCurrency(arm.portfolioAtMilestone)}</Text>
    </View>
  );
}

export function EarlyYearsDebtOrInvestPagePdf(
  input: RenderPdfInput<EarlyYearsDebtOrInvestPageData>,
) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  if (data.loan == null || data.invest == null) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>Pay Down the Loan, or Invest?</Text>
        <Text style={s.empty}>{data.emptyMessage}</Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>Pay Down the Loan, or Invest?</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      <View style={s.cols}>
        <View style={s.main}>
          <Text style={s.lede}>
            {`An extra ${exactCurrency(data.monthlyAmount)} a month, for as long as the ${data.liabilityName} runs — sent two different places.`}
          </Text>

          <View style={s.arms}>
            <Arm arm={data.loan} milestoneAge={data.milestoneAge} accent={accent.accent} />
            <Arm arm={data.invest} milestoneAge={data.milestoneAge} accent={accent.accent} />
          </View>

          {data.takeaway != null && (
            <View style={[s.takeaway, { borderLeftColor: accent.accent }]}>
              <Text style={s.takeawayText}>{data.takeaway}</Text>
            </View>
          )}

          <Text style={s.footnote}>
            An extra loan payment is money out the door too, so this compares one use of it
            against the other — not against saving nothing. The extra payments stop the
            moment the loan clears.
          </Text>
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
