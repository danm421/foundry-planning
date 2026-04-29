import type { SpineData } from "./lib/derive-spine-data";
import { TimelineTick } from "./timeline-tick";
import { PairRow } from "./pair-row";
import { StageBand } from "./stage-band";
import { CombinedBlock } from "./combined-block";
import { BeneficiaryStrip } from "./beneficiary-strip";
import { TotalsRow } from "./totals-row";

export function DeathSpine({ data }: { data: SpineData }) {
  if (data.kind === "historical") {
    return (
      <div className="p-6 text-center text-ink-3">{data.message}</div>
    );
  }

  if (data.kind === "single-grantor") {
    return (
      <div className="px-2">
        <TimelineTick label="TODAY" year={data.today.year} />
        <TimelineTick
          label={`DEATH · ${data.survivorName.toUpperCase()}`}
          year={data.death.year}
        />
        <StageBand kind="tax" label="Taxes & Expenses" value={-data.death.tax} />
        <StageBand kind="heirs" label="To heirs (gross)" value={data.death.toHeirs} />
        <BeneficiaryStrip cards={data.beneficiaries} />
        <TotalsRow
          taxesAndExpenses={data.totals.taxesAndExpenses}
          toHeirs={data.totals.toHeirs}
        />
      </div>
    );
  }

  // two-grantor
  return (
    <div className="px-2">
      <TimelineTick label="TODAY" year={data.today.year} />
      <PairRow client={data.pair.client} spouse={data.pair.spouse} />
      <Chevron />
      <TimelineTick
        label={`FIRST DEATH · ${data.firstDeath.deceasedName.toUpperCase()}`}
        year={data.firstDeath.year}
      />
      <StageBand kind="tax" label="Taxes & Expenses" value={-data.firstDeath.tax} />
      <StageBand kind="inherit" label="Inheritance to spouse" value={data.firstDeath.toSpouse} />
      {data.firstDeath.toHeirs > 0 && (
        <StageBand kind="heirs" label="To heirs at first death" value={data.firstDeath.toHeirs} />
      )}
      <CombinedBlock value={data.combined.value} />
      <TimelineTick
        label={`SECOND DEATH · ${data.secondDeath.deceasedName.toUpperCase()}`}
        year={data.secondDeath.year}
      />
      <StageBand kind="tax" label="Taxes & Expenses" value={-data.secondDeath.tax} />
      <StageBand kind="heirs" label="To heirs at second death" value={data.secondDeath.toHeirs} />
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
