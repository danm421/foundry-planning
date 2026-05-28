import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent, TimelineEventDetail, TimelineCategory } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function termLabel(termMonths: number): string {
  return termMonths % 12 === 0 ? `${termMonths / 12}yr` : `${termMonths}mo`;
}

function maturityYear(startYear: number, startMonth: number, termMonths: number): number {
  return startYear + Math.floor((startMonth - 1 + termMonths - 1) / 12);
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

export function detectNotesReceivableEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  const trustEntityNameById = new Map<string, string>();
  for (const e of data.entities ?? []) {
    if (e.trustSubType) trustEntityNameById.set(e.id, e.name ?? e.id);
  }

  for (const note of data.notesReceivable ?? []) {
    const linkedTrustName = note.linkedTrustEntityId
      ? trustEntityNameById.get(note.linkedTrustEntityId)
      : undefined;
    const category: TimelineCategory = linkedTrustName ? "estate" : "transaction";

    // Origination
    if (inRange(note.startYear, projection)) {
      const title = linkedTrustName ? `Sale to ${linkedTrustName}` : `${note.name} originated`;
      const origDetails: TimelineEventDetail[] = [
        { label: "Face value", value: currency(note.faceValue) },
        { label: "Basis", value: currency(note.basis) },
        { label: "Interest rate", value: pct(note.interestRate) },
        { label: "Payment type", value: note.paymentType === "amortizing" ? "Amortizing" : "Interest-only balloon" },
        { label: "Term", value: termLabel(note.termMonths) },
      ];
      if (note.paymentType === "amortizing" && typeof note.monthlyPayment === "number") {
        origDetails.push({ label: "Monthly payment", value: currency(note.monthlyPayment) });
      }
      if (linkedTrustName) {
        origDetails.push({ label: "Linked trust", value: linkedTrustName });
      }

      out.push({
        id: `${category}:note_origination:${note.id}`,
        year: note.startYear,
        category,
        subject: "joint",
        title,
        supportingFigure: `${currency(note.faceValue)} · ${pct(note.interestRate)} · ${termLabel(note.termMonths)}`,
        details: origDetails,
      });
    }

    // Maturity
    const maturity = maturityYear(note.startYear, note.startMonth, note.termMonths);
    if (inRange(maturity, projection)) {
      let totalInterest = 0;
      let finalBalance = 0;
      for (const py of projection) {
        const row = py.notesReceivableByNote?.[note.id];
        if (row) {
          totalInterest += row.interest ?? 0;
          if (py.year === maturity) finalBalance = row.endingBalance ?? 0;
        }
      }

      const matureDetails: TimelineEventDetail[] = [
        { label: "Total interest received", value: currency(totalInterest) },
        { label: "Final maturity month", value: String(((note.startMonth + note.termMonths - 2) % 12) + 1) },
      ];
      if (finalBalance > 1) {
        matureDetails.push({ label: "Remaining balance at maturity", value: currency(finalBalance) });
      }
      const hadLumpExtras = (note.extraPayments ?? []).some((x) => x.type === "lump_sum");
      if (hadLumpExtras) {
        matureDetails.push({ label: "Paid off early via lump-sum extras", value: "Yes" });
      }

      out.push({
        id: `${category}:note_maturity:${note.id}`,
        year: maturity,
        category,
        subject: "joint",
        title: linkedTrustName ? `Sale to ${linkedTrustName} matures` : `${note.name} paid off`,
        supportingFigure: `${currency(totalInterest)} interest received`,
        details: matureDetails,
      });
    }

    // Lump-sum extras
    for (const x of note.extraPayments ?? []) {
      if (x.type !== "lump_sum") continue;
      if (!inRange(x.year, projection)) continue;
      const py = projection.find((p) => p.year === x.year);
      const remaining = py?.notesReceivableByNote?.[note.id]?.endingBalance;
      const xDetails: TimelineEventDetail[] = [
        { label: "Amount", value: currency(x.amount) },
        { label: "Note", value: note.name },
      ];
      if (typeof remaining === "number") {
        xDetails.push({ label: "Remaining balance after payment", value: currency(remaining) });
      }

      out.push({
        id: `${category}:note_extra:${x.id}`,
        year: x.year,
        category,
        subject: "joint",
        title: `${note.name} — extra payment`,
        supportingFigure: `${currency(x.amount)} lump sum`,
        details: xDetails,
      });
    }
  }

  return out;
}
