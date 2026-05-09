import type { ProjectionResult } from "@/engine";
import type { ClientData } from "@/engine/types";
import {
  buildEstateTransferReportData,
  type RecipientTotal,
} from "./transfer-report";

export type Ordering = "primaryFirst" | "spouseFirst";

export type BeneficiaryKind =
  | "family_member"
  | "external_beneficiary"
  | "entity"
  | "system_default";

export interface BeneficiaryYearShare {
  /** Stable key composed of recipientKind|recipientId. Mirrors RecipientTotal.key. */
  key: string;
  recipientLabel: string;
  recipientKind: BeneficiaryKind;
  fromFirstDeath: number;
  fromSecondDeath: number;
}

export interface YearlyBeneficiaryRow {
  year: number;
  beneficiaries: BeneficiaryYearShare[];
}

export interface BeneficiarySummary {
  key: string;
  recipientLabel: string;
  recipientKind: BeneficiaryKind;
  /** Sum of fromFirstDeath + fromSecondDeath across all years. */
  lifetimeTotal: number;
}

export interface YearlyBeneficiaryBreakdown {
  ordering: Ordering;
  rows: YearlyBeneficiaryRow[];
  /** Stable union of all non-spouse beneficiaries seen across all years,
   *  sorted descending by lifetime total. Charts use this to determine
   *  stable stacking order. */
  beneficiaries: BeneficiarySummary[];
}

export function buildYearlyBeneficiaryBreakdown(
  projection: ProjectionResult,
  ordering: Ordering,
  clientData: ClientData,
  ownerNames: { clientName: string; spouseName: string | null },
): YearlyBeneficiaryBreakdown {
  const rows: YearlyBeneficiaryRow[] = [];
  const lifetimeMap = new Map<string, BeneficiarySummary>();

  for (const projYear of projection.years) {
    const year = projYear.year;
    const data = buildEstateTransferReportData({
      projection,
      asOf: { kind: "year", year },
      ordering,
      clientData,
      ownerNames,
    });

    const beneficiaries = data.aggregateRecipientTotals
      .filter(
        (r): r is RecipientTotal & { recipientKind: BeneficiaryKind } =>
          r.recipientKind !== "spouse",
      )
      .map((r) => ({
        key: r.key,
        recipientLabel: r.recipientLabel,
        recipientKind: r.recipientKind,
        fromFirstDeath: r.fromFirstDeath,
        fromSecondDeath: r.fromSecondDeath,
      }));

    rows.push({ year, beneficiaries });

    for (const b of beneficiaries) {
      const sum = b.fromFirstDeath + b.fromSecondDeath;
      const existing = lifetimeMap.get(b.key);
      if (existing) {
        existing.lifetimeTotal += sum;
      } else {
        lifetimeMap.set(b.key, {
          key: b.key,
          recipientLabel: b.recipientLabel,
          recipientKind: b.recipientKind,
          lifetimeTotal: sum,
        });
      }
    }
  }

  const beneficiaries = Array.from(lifetimeMap.values()).sort(
    (a, b) => b.lifetimeTotal - a.lifetimeTotal,
  );

  return { ordering, rows, beneficiaries };
}
