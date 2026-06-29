import type { medicareCoverage } from "@/db/schema";
import type { MedicareCoverage } from "@/engine/types";

type Row = typeof medicareCoverage.$inferSelect;
type Insert = typeof medicareCoverage.$inferInsert;

const parseDecimal = (v: string | null): number | null =>
  v === null ? null : Number(v);

export function rowToMedicareCoverage(row: Row): MedicareCoverage {
  // ownerEnum is shared across tables and allows "joint"; medicare_coverage is per-person only.
  if (row.owner !== "client" && row.owner !== "spouse") {
    throw new Error(`medicare_coverage row has unexpected owner "${row.owner}" — expected "client" or "spouse"`);
  }
  return {
    owner: row.owner,
    enrollmentYear: row.enrollmentYear,
    coverageType: row.coverageType,
    medigapMonthlyAt65: parseDecimal(row.medigapMonthlyAt65),
    partDPlanMonthlyAt65: parseDecimal(row.partDPlanMonthlyAt65),
    priorYearMagi: parseDecimal(row.priorYearMagi),
    estimatePriorYearMagiFromProjection: row.estimatePriorYearMagiFromProjection ?? false,
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
    estimatePriorYearMagiFromProjection: c.estimatePriorYearMagiFromProjection ?? false,
  };
}
