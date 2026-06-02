import type {
  DeathSectionData,
  EstateTransferReportData,
} from "@/lib/estate/transfer-report";

export interface EstateSummaryHeirRow {
  key: string;
  recipientLabel: string;
  todayOutright: number;
  todayInTrust: number;
  todayTotal: number;
  eolOutright: number;
  eolInTrust: number;
  eolTotal: number;
}

interface GrossForm {
  outright: number;
  inTrust: number;
}

// Gross outright/in-trust per heir, summed across both death sections. Skips the
// surviving spouse so the keys line up with aggregateRecipientTotals (which also
// excludes the spouse pass-through).
function grossFormByHeir(report: EstateTransferReportData): Map<string, GrossForm> {
  const m = new Map<string, GrossForm>();
  for (const section of [report.firstDeath, report.secondDeath]) {
    if (!section) continue;
    for (const r of (section as DeathSectionData).recipients) {
      if (r.recipientKind === "spouse") continue;
      let entry = m.get(r.key);
      if (!entry) {
        entry = { outright: 0, inTrust: 0 };
        m.set(r.key, entry);
      }
      for (const mech of r.byMechanism) {
        for (const a of mech.assets) {
          if (a.amount <= 0) continue;
          if (a.distributionForm === "in_trust") entry.inTrust += a.amount;
          else entry.outright += a.amount;
        }
      }
    }
  }
  return m;
}

function splitNetByForm(net: number, form: GrossForm | undefined): { outright: number; inTrust: number } {
  const grossTotal = form ? form.outright + form.inTrust : 0;
  if (!form || grossTotal <= 0) return { outright: net, inTrust: 0 };
  const inTrust = net * (form.inTrust / grossTotal);
  return { outright: net - inTrust, inTrust };
}

export function buildHeirRows(
  today: EstateTransferReportData,
  eol: EstateTransferReportData,
): EstateSummaryHeirRow[] {
  const todayForm = grossFormByHeir(today);
  const eolForm = grossFormByHeir(eol);
  const rows = new Map<string, EstateSummaryHeirRow>();

  const ensure = (key: string, label: string): EstateSummaryHeirRow => {
    let r = rows.get(key);
    if (!r) {
      r = {
        key, recipientLabel: label,
        todayOutright: 0, todayInTrust: 0, todayTotal: 0,
        eolOutright: 0, eolInTrust: 0, eolTotal: 0,
      };
      rows.set(key, r);
    }
    return r;
  };

  for (const t of today.aggregateRecipientTotals) {
    const r = ensure(t.key, t.recipientLabel);
    const s = splitNetByForm(t.total, todayForm.get(t.key));
    r.todayOutright = s.outright;
    r.todayInTrust = s.inTrust;
    r.todayTotal = t.total;
  }
  for (const t of eol.aggregateRecipientTotals) {
    const r = ensure(t.key, t.recipientLabel);
    const s = splitNetByForm(t.total, eolForm.get(t.key));
    r.eolOutright = s.outright;
    r.eolInTrust = s.inTrust;
    r.eolTotal = t.total;
  }

  return Array.from(rows.values()).sort(
    (a, b) => b.eolTotal + b.todayTotal - (a.eolTotal + a.todayTotal),
  );
}
