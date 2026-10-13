// src/lib/fact-finder/read-run.ts
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { mergeAcrossFiles } from "@/lib/imports/assemble/merge-across-files";
import { downloadImportFile } from "@/lib/imports/blob";
import { runImportExtraction } from "@/lib/imports/run-extraction";
import { narrate } from "@/lib/statement-chat/narrate";
import { detectRollups } from "@/lib/statement-chat/rollups";
import { applyLinkScores } from "./matching/score";
import { mergeReadings } from "./merge";
import {
  FactFinderNotFoundError,
  listLiveFiles,
  loadFactFinder,
  loadFileResults,
  updateFactFinder,
  type FactFinderScope,
  type ImportFileRow,
} from "./persist";
import { buildReadSummary } from "./read-summary";
import { readingsFromFormFields } from "./readers/form-reader";
import { pagesForSectionReader, routeFile } from "./readers/route-file";
import { readSections } from "./readers/section-reader";
import { readingsFromStatements } from "./readers/statement-adapter";
import { needsReading } from "./reading-status";
import { loadBaseCaseRecords } from "./relink";
import type { ReadEvent } from "./api-types";
import type { FFFileReading, FFMergeDecision, FFReader, FFReaderOutput } from "./types";

const FILE_CONCURRENCY = 3;

/**
 * The read route stops starting new files after this long: its maxDuration
 * (300 s) less 30 s to finish the files in flight and write the summary.
 */
export const READ_BUDGET_MS = 270_000;

export interface RunReadArgs {
  scope: FactFinderScope;
  extractHoldings: boolean;
  signal?: AbortSignal;
  onEvent?: (event: ReadEvent) => void;
  now?: () => Date;
}

export interface RunReadResult {
  summary: string;
  caveats: string[];
  version: number;
  filesRead: number;
}

async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const errorText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 200) : "Couldn't read this file.");

/**
 * Pass 1 for one import: read every unread file with its reader, merge each
 * file's readings as it settles, score links, and add one summary turn.
 */
export async function runFactFinderRead(args: RunReadArgs): Promise<RunReadResult> {
  const { scope, extractHoldings, signal } = args;
  const now = args.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const emit = (event: ReadEvent) => {
    try {
      args.onEvent?.(event);
    } catch (err) {
      console.error("[fact-finder-read] onEvent threw:", errorText(err));
    }
  };

  const nothingNew = (version: number): RunReadResult => ({ summary: "Nothing new to read.", caveats: [], version, filesRead: 0 });

  const [start, files] = await Promise.all([loadFactFinder(scope), listLiveFiles(scope.importId)]);
  if (!start) throw new FactFinderNotFoundError();
  const liveIds = new Set(files.map((f) => f.id));
  const todo = files.filter((f) => needsReading(start.readings[f.id], now()));
  if (todo.length === 0) return nothingNew(start.version);

  // Before the claim: a failure here must not leave files "reading" with no Retry.
  const records = await loadBaseCaseRecords(scope.clientId);

  // Claim against the fresh state: an overlapping read may have claimed some
  // of these files since `start` was loaded. `mutate` can run more than once,
  // so `claimed` holds the list from the attempt that was committed.
  const startedAt = iso();
  let claimed: ImportFileRow[] = [];
  const afterClaim = await updateFactFinder(scope, (s) => {
    claimed = todo.filter((f) => needsReading(s.readings[f.id], now()));
    if (claimed.length === 0) return s;
    return {
      ...s,
      readings: {
        ...s.readings,
        ...Object.fromEntries(claimed.map((f): [string, FFFileReading] => [f.id, { status: "reading", startedAt }])),
      },
    };
  });
  if (claimed.length === 0) return nothingNew(afterClaim.version);

  for (const f of claimed) emit({ type: "file", fileId: f.id, fileName: f.originalFilename, status: "reading" });

  const decisions: FFMergeDecision[] = [];
  const caveats: string[] = [];
  const failed: Array<{ fileName: string; reason: string }> = [];
  const settled = new Set<string>();

  const settle = async (file: ImportFileRow, reader: FFReader | undefined, output: FFReaderOutput | null, error?: string) => {
    let latest: FFMergeDecision[] = [];
    const rows = output?.readings.length ?? 0;
    await updateFactFinder(scope, (s) => {
      const at = iso();
      const merged = output
        ? mergeReadings(s, output.readings, { now: at, newId: randomUUID }, output.unassignedHoldings)
        : { state: s, decisions: [] };
      latest = merged.decisions;
      const status: FFFileReading = {
        status: error ? "failed" : "done",
        startedAt: s.readings[file.id]?.startedAt ?? startedAt,
        finishedAt: at,
        rows,
        ...(reader ? { reader } : {}),
        ...(error ? { reason: error } : {}),
        ...(output?.warnings.length ? { warnings: output.warnings } : {}),
      };
      return { ...merged.state, readings: { ...merged.state.readings, [file.id]: status } };
    });
    decisions.push(...latest);
    if (output) caveats.push(...output.warnings);
    if (error) failed.push({ fileName: file.originalFilename, reason: error });
    settled.add(file.id);
    emit({
      type: "file",
      fileId: file.id,
      fileName: file.originalFilename,
      status: error ? "failed" : "done",
      rows,
      ...(reader ? { reader } : {}),
      ...(error ? { error } : {}),
    });
  };

  const audit = (file: ImportFileRow, ok: boolean, metadata: Record<string, unknown>) =>
    recordAudit({
      action: ok ? "import.extraction.completed" : "import.extraction.failed",
      resourceType: "client_import_file",
      resourceId: file.id,
      clientId: scope.clientId,
      firmId: scope.firmId,
      metadata: { importId: scope.importId, surface: "fact_finder", ...metadata },
    });

  const downloadOrThrow = async (file: ImportFileRow) => {
    const buffer = await downloadImportFile(file.blobUrl);
    if (!buffer) throw new Error("Couldn't download this file.");
    return buffer;
  };

  const readAsSections = async (file: ImportFileRow, extraWarnings: string[] = []) => {
    const buffer = await downloadOrThrow(file);
    const { pages, warnings } = await pagesForSectionReader(buffer, file.detectedKind);
    const output = await readSections({ fileId: file.id, pages });
    output.warnings.unshift(...warnings, ...extraWarnings);
    return output;
  };

  const statementFiles: ImportFileRow[] = [];
  try {
    await eachLimited(claimed, FILE_CONCURRENCY, async (file) => {
      if (signal?.aborted) return;
      try {
        const buffer = await downloadOrThrow(file);
        const route = await routeFile({
          buffer,
          fileName: file.originalFilename,
          detectedKind: file.detectedKind,
          documentType: file.documentType,
        });
        // Past the time budget: leave it for the next read rather than start a model read now.
        if (signal?.aborted) return;
        if (route.reader === "statement") {
          statementFiles.push(file);
          return;
        }
        const output =
          route.reader === "form"
            ? readingsFromFormFields(file.id, route.fields)
            : await readSections({ fileId: file.id, pages: route.pages });
        if (route.reader === "section") output.warnings.unshift(...route.warnings);
        await settle(file, route.reader, output);
        await audit(file, true, { reader: route.reader, rows: output.readings.length });
      } catch (err) {
        const reason = errorText(err);
        await settle(file, undefined, null, reason);
        await audit(file, false, { error: reason });
      }
    });

    if (statementFiles.length > 0 && !signal?.aborted) {
      const extractionErrors = new Map<string, string | undefined>();
      try {
        await runImportExtraction({
          importId: scope.importId,
          clientId: scope.clientId,
          firmId: scope.firmId,
          model: "mini",
          extractHoldings,
          skipExtracted: true,
          fileIds: statementFiles.map((f) => f.id),
          signal,
          onFile: (p) => extractionErrors.set(p.fileId, p.error),
        });
      } catch (err) {
        for (const f of statementFiles) extractionErrors.set(f.id, errorText(err));
      }
      const [fileResults, current] = await Promise.all([loadFileResults(scope), loadFactFinder(scope)]);

      const fresh: ImportFileRow[] = [];
      for (const f of statementFiles) {
        const result = fileResults[f.id];
        if (!result) {
          await settle(f, "statement", null, extractionErrors.get(f.id) ?? "Couldn't read this statement.");
        } else if (
          result.extracted.accounts.length === 0 &&
          result.extracted.liabilities.length === 0 &&
          result.extracted.lifePolicies.length === 0
        ) {
          // Past the time budget: leave it for the next read, which skips straight to this fallback.
          if (signal?.aborted) continue;
          try {
            const note = `${f.originalFilename} had no accounts a statement reader could find, so it was read as a general document.`;
            await settle(f, "section", await readAsSections(f, [note]));
          } catch (err) {
            await settle(f, undefined, null, errorText(err));
          }
        } else {
          fresh.push(f);
        }
      }

      if (fresh.length > 0) {
        // Re-merge every statement read so far: newest statement wins and
        // rollups are found across files. Merging is idempotent, so rows the
        // advisor already edited or removed stay as they are.
        const earlier = Object.entries(current?.readings ?? {})
          .filter(([, r]) => r.reader === "statement" && r.status === "done")
          .map(([id]) => id);
        // Live files only: deleting a file leaves its stored result behind.
        const ids = [...new Set([...earlier, ...fresh.map((f) => f.id)])].filter(
          (id) => fileResults[id] && liveIds.has(id),
        );
        const merged = mergeAcrossFiles(Object.fromEntries(ids.map((id) => [id, fileResults[id]])));
        const rollups = detectRollups(merged.payload.accounts);
        const readings = readingsFromStatements({
          accounts: rollups.kept,
          excluded: rollups.excluded.map((e) => ({ row: e.row, reason: e.reason })),
          liabilities: merged.payload.liabilities,
          lifePolicies: merged.payload.lifePolicies,
          family: records.candidates.family,
        });
        // The statement reader's own narration of THIS read's statements (earlier
        // ones were narrated when they were read): which replaced older ones,
        // values that disagreed, undated statements. Rollups are left to the
        // summary, which notes each once, when it lands in the Removed tray.
        // Rows go in without `basis`: the fact finder shows no IRA basis for
        // narrate's basis note to explain.
        const ofThisRead = mergeAcrossFiles(Object.fromEntries(fresh.map((f) => [f.id, fileResults[f.id]])));
        const narration = narrate({
          fileCount: fresh.length,
          decisions: ofThisRead.decisions,
          rows: detectRollups(ofThisRead.payload.accounts).kept.map((row) => ({ ...row, basis: undefined })),
        });
        caveats.push(narration.summary, ...narration.caveats);
        const rowsFor = (fileId: string) => readings.filter((r) => r.fileId === fileId).length;
        let latest: FFMergeDecision[] = [];
        await updateFactFinder(scope, (s) => {
          const at = iso();
          const m = mergeReadings(s, readings, { now: at, newId: randomUUID });
          latest = m.decisions;
          const statuses = Object.fromEntries(
            fresh.map((f): [string, FFFileReading] => [
              f.id,
              { status: "done", reader: "statement", startedAt: s.readings[f.id]?.startedAt ?? startedAt, finishedAt: at, rows: rowsFor(f.id) },
            ]),
          );
          return { ...m.state, readings: { ...m.state.readings, ...statuses } };
        });
        decisions.push(...latest);
        for (const f of fresh) {
          settled.add(f.id);
          emit({ type: "file", fileId: f.id, fileName: f.originalFilename, status: "done", reader: "statement", rows: rowsFor(f.id) });
        }
      }
    }
  } finally {
    for (const f of claimed.filter((x) => !settled.has(x.id))) {
      await settle(f, undefined, null, "Stopped before this file was read.");
    }
  }

  const filesRead = claimed.length - failed.length;
  let built = { summary: "", caveats: [] as string[] };
  const final = await updateFactFinder(scope, (state) => {
    const s = applyLinkScores(state, records);
    built = buildReadSummary({ state: s, decisions, filesRead, failed, caveats });
    const text = [built.summary, ...built.caveats.map((c) => `• ${c}`)].join("\n");
    return { ...s, transcript: [...s.transcript, { id: randomUUID(), role: "assistant", text, at: iso() }] };
  });
  return { summary: built.summary, caveats: built.caveats, version: final.version, filesRead };
}
