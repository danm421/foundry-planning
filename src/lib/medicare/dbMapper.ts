import type { medicareCoverage } from "@/db/schema";
import type { MedicareCoverage } from "@/engine/types";

type Row = typeof medicareCoverage.$inferSelect;
type Insert = typeof medicareCoverage.$inferInsert;

const parseDecimal = (v: string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export function rowToMedicareCoverage(row: Row): MedicareCoverage {
  return {
    owner: row.owner as "client" | "spouse",
    enrollmentYear: row.enrollmentYear,
    coverageType: row.coverageType,
    medigapMonthlyAt65: parseDecimal(row.medigapMonthlyAt65),
    partDPlanMonthlyAt65: parseDecimal(row.partDPlanMonthlyAt65),
    priorYearMagi: parseDecimal(row.priorYearMagi),
  };
}

export function medicareCoverageToInsert(
  c: MedicareCoverage,
  clientId: string,
): Insert {
  return {
    clientId,
    owner: c.owner,
    enrollmentYear: c.enrollmentYear,
    coverageType: c.coverageType,
    medigapMonthlyAt65: c.medigapMonthlyAt65 === null ? null : String(c.medigapMonthlyAt65),
    partDPlanMonthlyAt65: c.partDPlanMonthlyAt65 === null ? null : String(c.partDPlanMonthlyAt65),
    priorYearMagi: c.priorYearMagi === null ? null : String(c.priorYearMagi),
  };
}
