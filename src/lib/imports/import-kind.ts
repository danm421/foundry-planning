// src/lib/imports/import-kind.ts
// Which kind of import is this, and where does it open? Pure — no db or next
// imports — so client components can use it too.
import { emptyFactFinderState } from "@/lib/fact-finder/state";
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

/** The insert values that make a new import a fact finder import: its slice marks it, and it reads positions because the fact finder reviews them. */
export function factFinderImportSeed() {
  return { extractHoldings: true, payloadJson: { factFinder: emptyFactFinderState() } };
}

/** The screen an import opens on: the fact finder, or the Review Wizard. */
export function importScreenPath(clientId: string, importId: string, factFinder: boolean): string {
  return `/clients/${clientId}/details/import/${importId}${factFinder ? "/fact-finder" : ""}`;
}
