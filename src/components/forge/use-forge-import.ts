// src/components/forge/use-forge-import.ts
//
// Client-side orchestrator for the in-chat document import. Drives the existing
// import endpoints in order — create (updating, base case) → upload → extract
// (with holdings) → match — then returns a compact summary for the chat. The
// matching step is non-fatal: the review wizard can re-run it on open.
"use client";

import { useCallback, useState } from "react";
import { resolveBaseScenarioId } from "./actions";
import type { AssembleState } from "@/lib/imports/assemble/types";

export type ForgeImportStatus =
  | "idle"
  | "creating"
  | "uploading"
  | "extracting"
  | "matching"
  | "assembling"
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

export interface PlanBuildResult {
  importId: string;
  clientId: string;
  reviewPath: string;
  assemble: AssembleState;
  warnings: string[];
}

// Mirror src/lib/imports/commit/types.ts COMMIT_TABS. Hardcoded because the
// commit module is server-only; keep this list in sync if tabs change.
const ALL_COMMIT_TABS = [
  "plan-basics", "clients-identity", "family-members", "accounts", "incomes",
  "expenses", "liabilities", "life-insurance", "wills", "entities", "goals",
] as const;

export interface FactFinderIdentifyResponse {
  isHouseholdDoc: boolean;
  identity?: {
    householdName: string;
    primary?: { firstName: string; lastName?: string; dateOfBirth?: string };
    spouse?: { firstName: string; lastName?: string; dateOfBirth?: string };
    dependents: { firstName: string; lastName?: string; dateOfBirth?: string }[];
    state?: string;
    filingStatus?: "single" | "married_joint" | "married_separate" | "head_of_household";
    retirementAge?: number;
    lifeExpectancy?: number;
  };
  duplicateCandidates: { householdId: string; clientId: string | null; name: string; status: string }[];
}

export interface UseForgeImportResult {
  status: ForgeImportStatus;
  errorMessage: string | null;
  runImport: (clientId: string, files: File[]) => Promise<ForgeImportResult | null>;
  runPlanBuild: (args: {
    clientId: string;
    importId: string;
    files: File[];
    mode?: "new" | "updating";
  }) => Promise<PlanBuildResult | null>;
  identifyFactFinder: (files: File[]) => Promise<FactFinderIdentifyResponse | null>;
  commitAllTabs: (clientId: string, importId: string) => Promise<{ status: "committed" | "review" } | null>;
  submitPlanAnswers: (args: {
    clientId: string;
    importId: string;
    answers: Record<string, string>;
  }) => Promise<{ ok: boolean; remaining: number } | null>;
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

  const runPlanBuild = useCallback(
    async (args: {
      clientId: string;
      importId: string;
      files: File[];
      mode?: "new" | "updating";
    }): Promise<PlanBuildResult | null> => {
      const { clientId, importId, files, mode = "new" } = args;
      setErrorMessage(null);
      try {
        // 1. Upload each file to the already-minted import (created by the
        //    build_plan tool — no separate create step here).
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

        // 2. Extract (with holdings).
        setStatus("extracting");
        const exRes = await fetch(`/api/clients/${clientId}/imports/${importId}/extract`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extractHoldings: true }),
        });
        if (!exRes.ok) throw new Error(await errText(exRes, "Extraction failed."));
        const { succeeded, failed } = (await exRes.json()) as { succeeded: number; failed: number };
        const warnings: string[] = [];
        if (failed > 0) warnings.push(`${failed} of ${succeeded + failed} file(s) failed to extract.`);

        // 3. Annotate the payload: NEW → assemble (smart questions); UPDATING →
        //    match (reconcile vs existing base-case rows). Both leave the import's
        //    payloadJson ready for the Review Wizard / commit.
        if (mode === "updating") {
          setStatus("matching");
          const mRes = await fetch(`/api/clients/${clientId}/imports/${importId}/match`, { method: "POST" });
          if (!mRes.ok) warnings.push("Matching couldn't run — the review screen will match on open.");
          setStatus("done");
          return {
            importId,
            clientId,
            reviewPath: `/clients/${clientId}/details/import/${importId}`,
            assemble: { version: 1, mergedFileCount: 0, assumptions: [], questions: [] },
            warnings,
          };
        }

        setStatus("assembling");
        const asRes = await fetch(`/api/clients/${clientId}/imports/${importId}/assemble`, { method: "POST" });
        if (!asRes.ok) throw new Error(await errText(asRes, "Assembling the plan failed."));
        const { assemble } = (await asRes.json()) as { assemble: AssembleState };

        setStatus("done");
        return {
          importId,
          clientId,
          reviewPath: `/clients/${clientId}/details/import/${importId}`,
          assemble,
          warnings,
        };
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const submitPlanAnswers = useCallback(
    async (args: {
      clientId: string;
      importId: string;
      answers: Record<string, string>;
    }): Promise<{ ok: boolean; remaining: number } | null> => {
      const { clientId, importId, answers } = args;
      // Clear any prior error first (mirrors runPlanBuild). Without this a
      // failed submit's message survives a successful retry, leaving a stale
      // error box under a card that just accepted the answer.
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/clients/${clientId}/imports/${importId}/answers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers }),
        });
        if (!res.ok) {
          setErrorMessage(await errText(res, "Could not submit answers."));
          return null;
        }
        return (await res.json()) as { ok: boolean; remaining: number };
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const identifyFactFinder = useCallback(
    async (files: File[]): Promise<FactFinderIdentifyResponse | null> => {
      setErrorMessage(null);
      try {
        // The peek reads one document; send the first attachment (v1 = one
        // household per attach). Additional files still ride into the full
        // extract after the client is minted.
        const fd = new FormData();
        fd.append("file", files[0]);
        const res = await fetch(`/api/forge/fact-finder/identify`, { method: "POST", body: fd });
        if (!res.ok) {
          setErrorMessage(await errText(res, "Could not read this document."));
          return null;
        }
        return (await res.json()) as FactFinderIdentifyResponse;
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const commitAllTabs = useCallback(
    async (clientId: string, importId: string): Promise<{ status: "committed" | "review" } | null> => {
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/clients/${clientId}/imports/${importId}/commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tabs: ALL_COMMIT_TABS }),
        });
        if (!res.ok) {
          setErrorMessage(await errText(res, "Could not commit the plan."));
          return null;
        }
        return (await res.json()) as { status: "committed" | "review" };
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  return {
    status,
    errorMessage,
    runImport,
    runPlanBuild,
    identifyFactFinder,
    commitAllTabs,
    submitPlanAnswers,
    reset,
  };
}
