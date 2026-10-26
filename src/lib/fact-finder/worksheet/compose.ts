// src/lib/fact-finder/worksheet/compose.ts
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { fenceUntrusted } from "../chat/fence";
import type { FactFinderState } from "../types";
import { stagingRowsNotShown } from "./from-staging";
import { stagingRowLine } from "./view";

export interface ComposeRequest {
  /** Done files not in composedFileIds — marked composed when the turn commits. */
  fileIds: string[];
  /** null: nothing for the model to do (only markComposed). */
  message: string | null;
}

/**
 * What the model is asked to do for files that finished reading since the last compose. A free-form file is read by
 * the model (read_document); every other reading already filled staging, so only its rows no table shows are listed.
 * The instructions stay outside the fence; file names and row lines are document text, so they are redacted and fenced.
 */
export function composeRequest(state: FactFinderState, files: { id: string; name: string }[]): ComposeRequest {
  const composed = new Set(state.worksheet.composedFileIds);
  const newFiles = files.filter((f) => state.readings[f.id]?.status === "done" && !composed.has(f.id));
  const unshown = stagingRowsNotShown(state);

  const freeform: string[] = [];
  const staged: string[] = [];
  for (const f of newFiles) {
    if (state.readings[f.id]?.reader === "freeform") {
      freeform.push(`- ${f.id} "${f.name}"`);
      continue;
    }
    const rows = unshown.filter(({ sectionId, rowId }) => state.sections[sectionId]?.find((r) => r.id === rowId)?.sourceFileIds.includes(f.id));
    if (rows.length) staged.push(`"${f.name}":`, ...rows.map(({ sectionId, rowId }) => stagingRowLine(state, sectionId, rowId)));
  }

  const parts: string[] = [];
  if (freeform.length) {
    parts.push(
      "These documents were just added and nobody has read them yet — read it with read_document, then add what it shows to the worksheet's topic tables:",
      fenceUntrusted(redactSsns(freeform.join("\n")).text),
    );
  }
  if (staged.length) {
    parts.push(
      "These documents were read into staging, but these rows are not on the worksheet yet — add them to the right topic tables with fill_from_staging:",
      fenceUntrusted(redactSsns(staged.join("\n")).text),
    );
  }
  return { fileIds: newFiles.map((f) => f.id), message: parts.length ? parts.join("\n\n") : null };
}
