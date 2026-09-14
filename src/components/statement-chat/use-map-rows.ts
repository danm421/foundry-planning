"use client";

import { useCallback, useState } from "react";
import { findEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { commitMapRow } from "./commit-map-row";

export type MapRowsStatus = "idle" | "running" | "done";

/** The map-pass route's own shape: one entry per entity that produced rows. */
export type RowsByEntity = Record<string, CandidateRow[]>;

/**
 * The map-driven review rows for one import: run the extraction pass over the
 * uploaded files, commit an accepted row to its entity's own route, and stamp
 * the extracted row so a second click cannot write a second record.
 *
 * SCOPE LIMIT — these rows are READ-ONLY on the review surface. There is no
 * inline editing in this phase: `columnsForEntity` (`map-columns.ts`) builds no
 * `edit` callback, so `entity-table.tsx`'s own `canEdit` is always false. A row
 * blocked by a missing required field is therefore completed on the Details tab
 * rather than here. This is deliberate, not an oversight — a generic scalar
 * editor could not fix `life_insurance_policy`'s required `ownerRef` anyway
 * (it is `kind: "object"`), which is the field most likely to come back missing
 * from a real statement.
 */
export function useMapRows({ clientId, importId }: { clientId: string; importId: string }) {
  const [rows, setRows] = useState<RowsByEntity>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<MapRowsStatus>("idle");
  const [committedRowIds, setCommittedRowIds] = useState<string[]>([]);

  const mapPassUrl = `/api/clients/${clientId}/imports/${importId}/chat/map-pass`;

  const addWarning = useCallback((message: string) => {
    setWarnings((prev) => [...prev, message]);
  }, []);

  /**
   * Run the map pass over every uploaded file.
   *
   * SEQUENTIAL ON PURPOSE — never `Promise.all`, and this loop must not be
   * "optimised" into one. `runMapEntityPass` persists its rows into
   * `client_imports.payloadJson` with a read-modify-write in JS, a race its own
   * "KNOWN RACE" comment documents and accepts. Two files of the SAME import
   * running concurrently interleave, and the later write drops the earlier
   * file's rows — the advisor silently loses a whole file's extraction with no
   * error anywhere. Running one file at a time is what keeps that race
   * unreachable from this surface.
   *
   * A file that fails costs only itself: its error is recorded as a warning
   * naming the file, and the remaining files still run.
   */
  const runPass = useCallback(
    async (fileIds: string[]) => {
      setStatus("running");
      setRows({});
      setWarnings([]);
      // MUST be reset with the rows. A rowId is `${fileId}:${entity}:${index}`
      // (`orchestrator.ts:80`) — POSITIONAL — so a re-read that puts a
      // different policy at index 0 would inherit the previous pass's lock and
      // render "Committed" with nothing written behind it.
      setCommittedRowIds([]);

      for (const fileId of fileIds) {
        try {
          const res = await fetch(mapPassUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fileId }),
          });

          if (!res.ok) {
            // `fetch` resolves normally on a 4xx/5xx — it never rejects — so an
            // HTTP error has to be read here, not only in the catch below.
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            addWarning(`${fileId}: ${body.error ?? `Request failed (HTTP ${res.status}).`}`);
            continue;
          }

          const body = (await res.json()) as { rows?: RowsByEntity; warnings?: string[] };
          const fileRows = body.rows ?? {};
          // Additive, exactly as the server's own merge is: the route returns
          // THIS file's rows, not the import's accumulated set, so overwriting
          // would show only the last file. Row ids are `<fileId>:<entity>:<n>`,
          // so rows from two files can never collide.
          setRows((prev) => {
            const next: RowsByEntity = { ...prev };
            for (const [entityId, list] of Object.entries(fileRows)) {
              next[entityId] = [...(next[entityId] ?? []), ...list];
            }
            return next;
          });
          for (const warning of body.warnings ?? []) addWarning(warning);
        } catch (err) {
          addWarning(`${fileId}: ${err instanceof Error ? err.message : "Could not reach the server."}`);
        }
      }

      setStatus("done");
    },
    [mapPassUrl, addWarning],
  );

  /**
   * Commit the accepted rows, one at a time, each to its OWN entity route.
   *
   * A row that fails leaves itself uncommitted, surfaces its error, and does
   * not stop the rest of the batch.
   */
  const commitRows = useCallback(
    async (rowIds: string[]) => {
      // Collected, not thrown on the spot: a failed row must not stop the rest
      // of the batch. They are raised together once every row has been tried.
      const failures: string[] = [];
      const byRowId = new Map<string, CandidateRow>();
      for (const list of Object.values(rows)) for (const r of list) byRowId.set(r.rowId, r);

      for (const rowId of rowIds) {
        const row = byRowId.get(rowId);
        if (!row) continue;

        const entity = findEntity(row.entityId);
        if (!entity) {
          // Silently skipping is the false-success shape: the row would read
          // "Committed" having written nothing at all.
          failures.push(`${row.entityId} is not in the Details field map, so this row cannot be written.`);
          continue;
        }

        const outcome = await commitMapRow({ clientId, entity, row });
        if (!outcome.ok) {
          // A row-level failure, so it is raised rather than filed as a
          // warning: `entity-table.tsx` renders a rejected `onCommitRows`
          // under the row's own Commit button, where the advisor is looking.
          // A message in the warnings card above a long table reads as a dead
          // button. The warnings card stays for PASS-level problems only.
          failures.push(`${entity.label}: ${outcome.error}`);
          continue;
        }
        for (const warning of outcome.warnings) addWarning(warning);

        // ONLY the id the create route itself returned. Never derived, never
        // reused from anywhere else: the PATCH stamps `match.existingId` with
        // whatever it is given, so a wrong id makes this row read "already
        // committed" forever while the real record is never touched again.
        // `null` means the response did not identify the record — `commitMapRow`
        // has already warned about it, and no stamp is better than a wrong one.
        if (outcome.createdId !== null) {
          try {
            const res = await fetch(mapPassUrl, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                entityId: row.entityId,
                rowId: row.rowId,
                createdId: outcome.createdId,
              }),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              addWarning(
                `${entity.label} was written, but marking the row as committed failed ` +
                  `(${body.error ?? `HTTP ${res.status}`}). Committing it again would create a duplicate.`,
              );
            }
          } catch (err) {
            addWarning(
              `${entity.label} was written, but marking the row as committed failed ` +
                `(${err instanceof Error ? err.message : "network error"}). ` +
                `Committing it again would create a duplicate.`,
            );
          }
        }

        // Locked once the ENTITY write succeeded — the record exists in the
        // plan whether or not the bookkeeping stamp above landed, and pretending
        // otherwise is what invites the second click that duplicates it.
        setCommittedRowIds((prev) => (prev.includes(rowId) ? prev : [...prev, rowId]));
      }

      if (failures.length > 0) throw new Error(failures.join(" "));
    },
    [clientId, mapPassUrl, rows, addWarning],
  );

  return { rows, warnings, status, committedRowIds, runPass, commitRows };
}
