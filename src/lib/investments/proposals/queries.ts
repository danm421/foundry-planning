import { db } from "@/db";
import { investmentProposals, securities } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ProposalSnapshot } from "./types";

export interface ProposalRow {
  id: string;
  name: string;
  status: "draft" | "presented" | "accepted";
  source: unknown;
  target: unknown;
  targetLabel: string;
  advisoryFeeCurrent: number | null;
  advisoryFeeProposed: number | null;
  overrideLtcgRate: number | null;
  notes: string | null;
  result: ProposalSnapshot;
  computedAt: Date;
  updatedAt: Date;
}

const num = (v: string | null): number | null => (v == null ? null : Number(v));

/** Every query is filtered by clientId; the caller has already proven access. */
export async function listProposals(clientId: string): Promise<ProposalRow[]> {
  const rows = await db
    .select()
    .from(investmentProposals)
    .where(eq(investmentProposals.clientId, clientId))
    .orderBy(desc(investmentProposals.updatedAt));
  return rows.map(toRow);
}

export async function getProposal(clientId: string, id: string): Promise<ProposalRow | null> {
  const [row] = await db
    .select()
    .from(investmentProposals)
    .where(and(eq(investmentProposals.clientId, clientId), eq(investmentProposals.id, id)));
  return row ? toRow(row) : null;
}

function toRow(r: typeof investmentProposals.$inferSelect): ProposalRow {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    source: r.source,
    target: r.target,
    targetLabel: r.targetLabel,
    advisoryFeeCurrent: num(r.advisoryFeeCurrent),
    advisoryFeeProposed: num(r.advisoryFeeProposed),
    overrideLtcgRate: num(r.overrideLtcgRate),
    notes: r.notes,
    result: r.result as ProposalSnapshot,
    computedAt: r.computedAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Expense ratio per security id, as a decimal fraction. A missing id and a
 * null column both resolve to null — unknown, never free.
 */
export async function loadExpenseRatios(
  securityIds: readonly string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (securityIds.length === 0) return out;
  const rows = await db
    .select({ id: securities.id, expenseRatio: securities.expenseRatio })
    .from(securities)
    .where(inArray(securities.id, [...securityIds]));
  for (const r of rows) out.set(r.id, num(r.expenseRatio));
  return out;
}
