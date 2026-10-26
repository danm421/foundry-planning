// src/components/fact-finder/screen-types.ts
// What the server page hands the fact finder screen. Types only, client-safe.
import type { FactFinderState } from "@/lib/fact-finder/types";
import type { ClientDocumentView } from "@/lib/imports/client-documents";

/** An uploaded document as the screen sees it — never its storage address. */
export interface FFScreenFile {
  id: string;
  name: string;
  documentType: string;
}

export interface FactFinderScreenProps {
  clientId: string;
  importId: string;
  initialState: FactFinderState;
  initialFiles: FFScreenFile[];
  /** Whether the plan already has a co-client (their family member exists) — the save leaves out lines that name one the import isn't adding. */
  hasCoClient: boolean;
  /** Files in the client's vault, offered in the upload box. */
  clientDocuments?: ClientDocumentView[];
}
