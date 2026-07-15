import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSolverReportLayout } from "@/db/schema";
import {
  resolveReportLayout,
  REPORT_KEYS,
  type ReportLayoutEntry,
} from "@/lib/solver/report-layout";

/**
 * Load an advisor's solver report layout, reconciled against the canonical
 * report set. Absent row → canonical default (all visible). Never throws for a
 * missing row; a query failure surfaces to the caller.
 */
export async function loadReportLayout(userId: string): Promise<ReportLayoutEntry[]> {
  const rows = await db
    .select({ layout: userSolverReportLayout.layout })
    .from(userSolverReportLayout)
    .where(eq(userSolverReportLayout.clerkUserId, userId))
    .limit(1);
  return resolveReportLayout(rows[0]?.layout ?? null, REPORT_KEYS);
}
