import { loadInsightsBattery } from "@/lib/insights/battery";
import { loadInsightProfile } from "@/lib/insights/persist";
import { hashBattery } from "@/lib/insights/hash";
import { Card, CardBody } from "@/components/card";
import MoneyText from "@/components/money-text";
import { RiskAlignmentScale } from "./risk-alignment-scale";
import { GeneratePanel } from "./generate-panel";

export async function InsightsContent({
  clientId,
  firmId,
}: {
  clientId: string;
  firmId: string;
}) {
  const battery = await loadInsightsBattery(clientId, firmId);
  const inputHash = hashBattery(battery);
  const profile = await loadInsightProfile(clientId);
  const stale = !profile || profile.inputHash !== inputHash;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      {battery.needsAttention.length > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-warn/30 bg-warn/10 p-4">
          <h3 className="mb-2 text-sm font-semibold text-warn">Needs attention</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {battery.needsAttention.map((f) => (
              <li key={f.kind}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Net worth</span>
            <MoneyText value={battery.kpis.netWorth} format="currency" size="kpi" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Yrs to retire</span>
            <MoneyText value={battery.kpis.yearsToRetirement} format="int" size="kpi" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">MC success</span>
            <MoneyText value={battery.kpis.mcSuccessRate} format="pct" size="kpi" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Funding</span>
            <span className="tabular text-[30px] font-medium tracking-[-0.03em]">
              {battery.kpis.fundingScore.toFixed(2)}
            </span>
          </CardBody>
        </Card>
      </div>

      <RiskAlignmentScale risk={battery.risk} />

      <GeneratePanel
        clientId={clientId}
        stale={stale}
        initial={
          profile
            ? {
                snapshot: profile.snapshot,
                goals: profile.goals,
                opportunities: profile.opportunities,
                generatedAt: profile.updatedAt.toISOString(),
                model: profile.model,
              }
            : null
        }
      />
    </div>
  );
}
