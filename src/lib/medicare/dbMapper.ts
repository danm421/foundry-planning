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
    estimatePriorYearMagiFromProjection: c.estimatePriorYearMagiFromProjection ?? true,
  };
}

/** Medicare is modeled for everyone by default. A person with no saved row
 *  gets enrollment at 65, national-average premiums (the nulls), and cold-start
 *  MAGI estimated from the projection. Saved rows always win. */
export function withDefaultMedicareCoverage(
  saved: MedicareCoverage[],
  hasSpouse: boolean,
): MedicareCoverage[] {
  const owners = hasSpouse ? (["client", "spouse"] as const) : (["client"] as const);
  const missing = owners.filter((owner) => !saved.some((c) => c.owner === owner));
  return [
    ...saved,
    ...missing.map((owner): MedicareCoverage => ({
      owner,
      enrollmentYear: null,
      coverageType: "original",
      medigapMonthlyAt65: null,
      partDPlanMonthlyAt65: null,
      priorYearMagi: null,
      estimatePriorYearMagiFromProjection: true,
    })),
  ];
}
