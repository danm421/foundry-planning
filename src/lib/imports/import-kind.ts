// src/lib/imports/import-kind.ts
// Which kind of import is this, and where does it open? A leaf — no db, next or
// fact finder imports — so client components (the Forge panel on every page)
// can use it without pulling in the fact finder's schema.
import type { ImportPayloadJson } from "./types";

/** A fact finder import, or a statement-chat import from before the switch. */
export function isFactFinderImport(payloadJson: ImportPayloadJson | null | undefined): boolean {
  return payloadJson?.chat?.surface === "chat" || payloadJson?.factFinder !== undefined;
}

/** The payload holds a fact finder saved to the plan. */
export function isSavedFactFinder(payloadJson: unknown): boolean {
  return (payloadJson as ImportPayloadJson | null)?.factFinder?.closed != null;
}

/** A statement-chat import finished before the switch: committed, with no saved fact finder (saving one commits the import too). */
export function isFinishedInStatementChat(status: string, payloadJson: ImportPayloadJson | null | undefined): boolean {
  return status === "committed" && isFactFinderImport(payloadJson) && !isSavedFactFinder(payloadJson);
}

/** The screen an import opens on: the fact finder, or the Review Wizard. */
export function importScreenPath(clientId: string, importId: string, factFinder: boolean): string {
  return `/clients/${clientId}/details/import/${importId}${factFinder ? "/fact-finder" : ""}`;
}
