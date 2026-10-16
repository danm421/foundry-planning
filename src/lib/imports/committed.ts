// src/lib/imports/committed.ts
/**
 * A committed import is finished: its rows are on the plan, and a fact finder
 * saved to the plan keeps its closed record and change list in `payload_json`
 * (Plan 4, D10). Every import route outside the fact finder module that writes
 * an import's `payload_json` or `status` refuses one before doing any work, and
 * its write also requires `status <> 'committed'`, so a save that lands while
 * the route runs is never written over.
 */
import { NextResponse } from "next/server";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";

/** The 409 a committed import gets, or null to go on. */
export function refuseCommittedImport(imp: { status: string }): NextResponse | null {
  return imp.status === "committed" ? NextResponse.json({ error: SAVE_CLOSED_MESSAGE }, { status: 409 }) : null;
}
