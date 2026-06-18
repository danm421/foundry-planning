// src/components/forge/use-forge-import.ts
//
// Client-side orchestrator for the in-chat document import. Drives the existing
// import endpoints in order — create (updating, base case) → upload → extract
// (with holdings) → match — then returns a compact summary for the chat. The
// matching step is non-fatal: the review wizard can re-run it on open.
"use client";

import { useCallback, useState } from "react";
import { resolveBaseScenarioId } from "./actions";

export type ForgeImportStatus =
  | "idle"
  | "creating"
  | "uploading"
  | "extracting"
  | "matching"
  | "done"
  | "error";

export interface ImportSummary {
  extract: { succeeded: number; failed: number };
  match: { exact: number; fuzzy: number; new: number };
}

export interface ForgeImportResult {
  importId: string;
  summary: ImportSummary;
  warnings: string[];
}

export interface UseForgeImportResult {
  status: ForgeImportStatus;
  errorMessage: string | null;
  runImport: (clientId: string, files: File[]) => Promise<ForgeImportResult | null>;
  reset: () => void;
}

async function errText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* body wasn't JSON — use the fallback */
  }
  return fallback;
}

export function useForgeImport(): UseForgeImportResult {
  const [status, setStatus] = useState<ForgeImportStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setErrorMessage(null);
  }, []);

  const runImport = useCallback(
    async (clientId: string, files: File[]): Promise<ForgeImportResult | null> => {
      setErrorMessage(null);
      try {
        // 1. Resolve the base-case scenario — the chat imports factual data into
        //    the base case, never the viewed scenario.
        setStatus("creating");
        const baseScenarioId = await resolveBaseScenarioId(clientId);
        if (!baseScenarioId) {
          throw new Error("This client has no base case to import into.");
        }

        // 2. Create the import in "updating" mode so matching runs vs base-case rows.
        const createRes = await fetch(`/api/clients/${clientId}/imports`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "updating", scenarioId: baseScenarioId }),
        });
        if (!createRes.ok) throw new Error(await errText(createRes, "Could not start the import."));
        const { import: imp } = (await createRes.json()) as { import: { id: string } };
        const importId = imp.id;

        // 3. Upload each file (reuses 20MB limit, magic-byte validation, dedupe).
        setStatus("uploading");
        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file);
          const upRes = await fetch(`/api/clients/${clientId}/imports/${importId}/files`, {
            method: "POST",
            body: fd,
          });
          if (!upRes.ok) throw new Error(await errText(upRes, `Could not upload ${file.name}.`));
        }

        // 4. Extract (with holdings).
        setStatus("extracting");
        const exRes = await fetch(`/api/clients/${clientId}/imports/${importId}/extract`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extractHoldings: true }),
        });
        if (!exRes.ok) throw new Error(await errText(exRes, "Extraction failed."));
        const { succeeded, failed } = (await exRes.json()) as { succeeded: number; failed: number };
        const extract = { succeeded, failed };

        // 5. Match against existing base-case rows. Non-fatal — wizard re-runs on open.
        setStatus("matching");
        const mRes = await fetch(`/api/clients/${clientId}/imports/${importId}/match`, {
          method: "POST",
        });
        const matchBody = mRes.ok
          ? ((await mRes.json()) as { exact: number; fuzzy: number; new: number })
          : { exact: 0, fuzzy: 0, new: 0 };
        const match = { exact: matchBody.exact, fuzzy: matchBody.fuzzy, new: matchBody.new };

        const warnings: string[] = [];
        if (extract.failed > 0) {
          const total = extract.succeeded + extract.failed;
          warnings.push(`${extract.failed} of ${total} file(s) failed to extract.`);
        }
        if (!mRes.ok) warnings.push("Matching couldn't run — the review screen will match on open.");

        setStatus("done");
        return { importId, summary: { extract, match }, warnings };
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  return { status, errorMessage, runImport, reset };
}
