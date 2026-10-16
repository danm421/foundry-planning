// src/lib/imports/saved-fact-finder.ts
/**
 * A fact finder saved to the plan is read-only (Plan 4, D10): its closed
 * record and change list live in the import's `payload_json`. The import
 * routes outside the fact finder module that write an import's `payload_json`
 * or `status` refuse one before doing any work, and their writes require the
 * payload to hold no closed fact finder, so a save that lands while a route
 * runs is never written over. A wizard import, committed or not, goes through
 * exactly as before Plan 4.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { clientImports } from "@/db/schema";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";
import { isFactFinderImport } from "./import-kind";
import type { ImportPayloadJson } from "./types";

/** The payload holds a fact finder saved to the plan. */
export function isSavedFactFinder(payloadJson: unknown): boolean {
  return (payloadJson as ImportPayloadJson | null)?.factFinder?.closed != null;
}

/** The answer for a saved fact finder — also when a guarded write found a save had landed while the route ran. */
export function savedFactFinderRefusal(): NextResponse {
  return NextResponse.json({ error: SAVE_CLOSED_MESSAGE }, { status: 409 });
}

/** The 409 a saved fact finder gets, or null to go on. */
export function refuseSavedFactFinder(imp: { payloadJson: unknown }): NextResponse | null {
  return isSavedFactFinder(imp.payloadJson) ? savedFactFinderRefusal() : null;
}

/** What the wizard-era routes answer for a fact finder import, open or saved. */
export const FACT_FINDER_ONLY_MESSAGE = "This is a fact finder import — open it on the fact finder screen.";

/** The 409 a fact finder import gets from a Review Wizard route, or null to go on. Call it right after `refuseSavedFactFinder`. */
export function refuseFactFinderImport(imp: { payloadJson: unknown }): NextResponse | null {
  return isFactFinderImport(imp.payloadJson as ImportPayloadJson | null)
    ? NextResponse.json({ error: FACT_FINDER_ONLY_MESSAGE }, { status: 409 })
    : null;
}

/** The WHERE leg every such write carries — persist.ts's own "not closed". */
export const noSavedFactFinder = sql`(${clientImports.payloadJson} -> 'factFinder' -> 'closed') IS NULL`;
