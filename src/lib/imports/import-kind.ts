// src/lib/imports/import-kind.ts
// Which kind of import is this, and where does it open? Pure — no db or next
// imports — so client components can use it too.
import type { ImportPayloadJson } from "./types";

/** A fact finder import, or a statement-chat import from before the switch. */
export function isFactFinderImport(payloadJson: ImportPayloadJson | null | undefined): boolean {
  return payloadJson?.chat?.surface === "chat" || payloadJson?.factFinder !== undefined;
}

/** The screen an import opens on: the fact finder, or the Review Wizard. */
export function importScreenPath(clientId: string, importId: string, factFinder: boolean): string {
  return `/clients/${clientId}/details/import/${importId}${factFinder ? "/fact-finder" : ""}`;
}
