import type { DeathTransfer } from "@/engine/types";
import type { SpineData } from "./lib/derive-spine-data";
import { TimelineTick } from "./timeline-tick";
import { PairRow } from "./pair-row";
import { StageBand } from "./stage-band";
import { CombinedBlock } from "./combined-block";
import { BeneficiaryStrip } from "./beneficiary-strip";
import { TotalsRow } from "./totals-row";
import { TaxCalcWalk } from "./expansions/tax-calc-walk";
import { TransferRows } from "./expansions/transfer-rows";
import { TrustFundingRows } from "./expansions/trust-funding-rows";

function nonTrustHeirTransfers(
  transfers: DeathTransfer[],
  entityIds: Set<string>,
): DeathTransfer[] {
  return transfers.filter(
    (t) =>
      t.amount > 0 &&
      t.recipientKind !== "spouse" &&
      !(t.recipientKind === "entity" && entityIds.has(t.recipientId ?? "")),
  );
}

export function DeathSpine({ data }: { data: SpineData }) {
  if (data.kind === "historical") {
    return <div className="p-6 text-center text-ink-3">{data.message}</div>;
  }

  if (data.kind === "single-grantor") {
    const entityIds = new Set(data.entities.map((e) => e.id));
    return (
      <div className="px-2">
        <TimelineTick label="TODAY" year={data.today.year} />
        <TimelineTick
          label={`DEATH · ${data.survivorName.toUpperCase()}`}
          year={data.death.year}
        />
        <StageBand
          kind="tax"
          label="Taxes & Expenses"
          value={-data.death.tax}
          expansion={
            <TaxCalcWalk breakdown={data.death.taxBreakdown} total={data.death.tax} />
          }
        />
        {data.death.toTrusts > 0 && (
          <StageBand
            kind="trusts"
            label="To Trusts"
            value={data.death.toTrusts}
            expansion={
              <TrustFundingRows transfers={data.death.transfers} entities={data.entities} />
            }
          />
        )}
        <StageBand
          kind="heirs"
          label="To heirs (gross)"
          value={data.death.toHeirs}
          expansion={
            <TransferRows transfers={nonTrustHeirTransfers(data.death.transfers, entityIds)} />
          }
        />
        <BeneficiaryStrip cards={data.beneficiaries} />
        <TotalsRow
          taxesAndExpenses={data.totals.taxesAndExpenses}
          toHeirs={data.totals.toHeirs}
        />
      </div>
    );
  }

  // two-grantor
  const entityIds = new Set(data.entities.map((e) => e.id));
  return (
    <div className="px-2">
      <TimelineTick label="TODAY" year={data.today.year} />
      <PairRow client={data.pair.client} spouse={data.pair.spouse} />
      <Chevron />
      <TimelineTick
        label={`FIRST DEATH · ${data.firstDeath.deceasedName.toUpperCase()}`}
        year={data.firstDeath.year}
      />
      <StageBand
        kind="tax"
        label="Taxes & Expenses"
        value={-data.firstDeath.tax}
        expansion={
          <TaxCalcWalk breakdown={data.firstDeath.taxBreakdown} total={data.firstDeath.tax} />
        }
      />
      <StageBand
        kind="inherit"
        label="Inheritance to spouse"
        value={data.firstDeath.toSpouse}
        expansion={
          <TransferRows
            transfers={data.firstDeath.transfers}
            filter={{ recipientKind: "spouse" }}
          />
        }
      />
      {data.firstDeath.toTrusts > 0 && (
        <StageBand
          kind="trusts"
          label="To Trusts"
          value={data.firstDeath.toTrusts}
          expansion={
            <TrustFundingRows
              transfers={data.firstDeath.transfers}
              entities={data.entities}
            />
          }
        />
      )}
      {data.firstDeath.toHeirs > 0 && (
        <StageBand
          kind="heirs"
          label="To heirs at first death"
          value={data.firstDeath.toHeirs}
          expansion={
            <TransferRows
              transfers={nonTrustHeirTransfers(data.firstDeath.transfers, entityIds)}
            />
          }
        />
      )}
      <CombinedBlock value={data.combined.value} />
      <TimelineTick
        label={`SECOND DEATH · ${data.secondDeath.deceasedName.toUpperCase()}`}
        year={data.secondDeath.year}
      />
      <StageBand
        kind="tax"
        label="Taxes & Expenses"
        value={-data.secondDeath.tax}
        expansion={
          <TaxCalcWalk
            breakdown={data.secondDeath.taxBreakdown}
            total={data.secondDeath.tax}
          />
        }
      />
      {data.secondDeath.toTrusts > 0 && (
        <StageBand
          kind="trusts"
          label="To Trusts"
          value={data.secondDeath.toTrusts}
          expansion={
            <TrustFundingRows
              transfers={data.secondDeath.transfers}
              entities={data.entities}
            />
          }
        />
      )}
      <StageBand
        kind="heirs"
        label="To heirs at second death"
        value={data.secondDeath.toHeirs}
        expansion={
          <TransferRows
            transfers={nonTrustHeirTransfers(data.secondDeath.transfers, entityIds)}
          />
        }
      />
      <BeneficiaryStrip cards={data.beneficiaries} />
      <TotalsRow
        taxesAndExpenses={data.totals.taxesAndExpenses}
        toHeirs={data.totals.toHeirs}
      />
    </div>
  );
}

function Chevron() {
  return <div aria-hidden="true" className="text-ink-3 text-center my-1">▼</div>;
}
