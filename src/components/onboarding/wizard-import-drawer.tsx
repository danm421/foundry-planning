"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import UploadZone from "@/components/import/upload-zone";
import type { ImportPayload, ImportPayloadJson } from "@/lib/imports/types";
import {
  STEP_IMPORT_LABEL,
  stepHasImportData,
  type ImportEligibleStep,
} from "@/lib/onboarding/import-sections";
import WizardImportReview from "./wizard-import-review";

interface WizardImportDrawerProps {
  clientId: string;
  step: ImportEligibleStep;
  /** Base case scenario id — required to create the import in 'updating' mode. */
  baseScenarioId: string;
  /** Shared wizard draft id from onboarding_state, or null if none yet. */
  activeImportId: string | null;
  onClose: () => void;
}

type Stage = "loading" | "upload" | "extracting" | "review" | "error";

interface LoadedImport {
  importId: string;
  payload: ImportPayload | null;
  perTabCommittedAt: Record<string, string> | null;
  fileCount: number;
}

export default function WizardImportDrawer({
  clientId,
  step,
  baseScenarioId,
  activeImportId,
  onClose,
}: WizardImportDrawerProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [imp, setImp] = useState<LoadedImport | null>(null);
  const [busy, setBusy] = useState(false);

  /** PATCH onboarding_state.activeImportId (set or clear). Non-blocking. */
  const setActiveImportId = useCallback(
    async (value: string | null) => {
      try {
        await fetch(`/api/clients/${clientId}/onboarding`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeImportId: value }),
        });
      } catch {
        // Non-blocking — the drawer still works for this session.
      }
    },
    [clientId],
  );

  /** GET an import; returns null if missing / committed / discarded. */
  const loadImport = useCallback(
    async (importId: string): Promise<LoadedImport | null> => {
      const res = await fetch(`/api/clients/${clientId}/imports/${importId}`);
      if (!res.ok) return null;
      const body = (await res.json()) as {
        import: {
          status: string;
          payloadJson: ImportPayloadJson | null;
          perTabCommittedAt: Record<string, string> | null;
        };
        files: unknown[];
      };
      if (
        body.import.status === "committed" ||
        body.import.status === "discarded"
      ) {
        return null;
      }
      return {
        importId,
        payload: body.import.payloadJson?.payload ?? null,
        perTabCommittedAt: body.import.perTabCommittedAt,
        fileCount: body.files.length,
      };
    },
    [clientId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!activeImportId) {
        if (!cancelled) setStage("upload");
        return;
      }
      const loaded = await loadImport(activeImportId);
      if (cancelled) return;
      if (!loaded) {
        void setActiveImportId(null);
        setStage("upload");
        return;
      }
      setImp(loaded);
      setStage(
        loaded.payload && stepHasImportData(loaded.payload, step)
          ? "review"
          : "upload",
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [activeImportId, step, loadImport, setActiveImportId]);

  /** Ensure a draft exists; returns its id. Creates one lazily if needed. */
  const ensureImport = useCallback(async (): Promise<string> => {
    if (imp) return imp.importId;
    const res = await fetch(`/api/clients/${clientId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "updating", scenarioId: baseScenarioId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(
        (j as { error?: string }).error ??
          `Could not start import (${res.status})`,
      );
    }
    const body = (await res.json()) as { import: { id: string } };
    const importId = body.import.id;
    setImp({ importId, payload: null, perTabCommittedAt: null, fileCount: 0 });
    void setActiveImportId(importId);
    return importId;
  }, [imp, clientId, baseScenarioId, setActiveImportId]);

  /** Run extract + match, then reload the import into the review stage. */
  const runExtraction = useCallback(async () => {
    if (!imp) return;
    setBusy(true);
    setError(null);
    setStage("extracting");
    try {
      const extractRes = await fetch(
        `/api/clients/${clientId}/imports/${imp.importId}/extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "mini" }),
        },
      );
      if (!extractRes.ok) {
        const j = await extractRes.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error ??
            `Extraction failed (${extractRes.status})`,
        );
      }
      // The extract route reports status "draft" when every file failed.
      const extractBody = (await extractRes.json()) as { status?: string };
      if (extractBody.status === "draft") {
        throw new Error(
          "Every uploaded file failed to extract. Check the file and try again.",
        );
      }
      const matchRes = await fetch(
        `/api/clients/${clientId}/imports/${imp.importId}/match`,
        { method: "POST" },
      );
      if (!matchRes.ok) {
        const j = await matchRes.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error ??
            `Matching failed (${matchRes.status})`,
        );
      }
      const reloaded = await loadImport(imp.importId);
      if (!reloaded) throw new Error("Import is no longer available.");
      setImp(reloaded);
      setStage("review");
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
    }
  }, [imp, clientId, loadImport]);

  const handleCommitted = useCallback(() => {
    router.refresh();
    onClose();
  }, [router, onClose]);

  // Close on Escape — `role="dialog"` implies modal semantics.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const hasDataForStep =
    stage === "review" && imp?.payload
      ? stepHasImportData(imp.payload, step)
      : false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close import drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Import ${STEP_IMPORT_LABEL[step]} from a document`}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-hair bg-card shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-hair px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Import {STEP_IMPORT_LABEL[step]} from a document
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Upload a planning document — we&apos;ll extract this step&apos;s
              data for review.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:bg-card-2 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 px-5 py-4">
          {stage === "loading" && (
            <p className="text-sm text-ink-3">Loading…</p>
          )}

          {stage === "upload" && (
            <div className="space-y-4">
              <UploadZoneGate
                clientId={clientId}
                importId={imp?.importId ?? null}
                ensureImport={ensureImport}
                onUploaded={() =>
                  setImp((cur) =>
                    cur ? { ...cur, fileCount: cur.fileCount + 1 } : cur,
                  )
                }
                onError={setError}
              />
              {error ? <p className="text-xs text-bad">{error}</p> : null}
              {imp && imp.fileCount > 0 ? (
                <button
                  type="button"
                  onClick={runExtraction}
                  disabled={busy}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-on disabled:opacity-60"
                >
                  {busy ? "Extracting…" : "Extract data"}
                </button>
              ) : (
                <p className="text-xs text-ink-4">
                  Extraction runs after at least one file is uploaded.
                </p>
              )}
            </div>
          )}

          {stage === "extracting" && (
            <p className="text-sm text-ink-3">
              Extracting — this can take 30–60 seconds per file…
            </p>
          )}

          {stage === "error" && (
            <div className="space-y-3">
              <p className="text-sm text-bad">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStage("upload");
                }}
                className="rounded border border-hair px-3 py-1.5 text-sm text-ink-2 hover:bg-card-2"
              >
                Back to upload
              </button>
            </div>
          )}

          {stage === "review" && imp?.payload && hasDataForStep && (
            <WizardImportReview
              clientId={clientId}
              importId={imp.importId}
              step={step}
              payload={imp.payload}
              perTabCommittedAt={imp.perTabCommittedAt}
              onCommitted={handleCommitted}
            />
          )}

          {stage === "review" && imp?.payload && !hasDataForStep && (
            <div className="space-y-3">
              <p className="text-sm text-ink-3">
                No {STEP_IMPORT_LABEL[step]} data found in the uploaded
                document(s).
              </p>
              <button
                type="button"
                onClick={() => setStage("upload")}
                className="rounded border border-hair px-3 py-1.5 text-sm text-ink-2 hover:bg-card-2"
              >
                Upload another document
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * UploadZone needs an importId, but the wizard draft is created lazily.
 * Until the parent has a draft (`importId` null) this renders a start button
 * that creates one; once it exists it renders the real UploadZone.
 */
function UploadZoneGate({
  clientId,
  importId,
  ensureImport,
  onUploaded,
  onError,
}: {
  clientId: string;
  importId: string | null;
  ensureImport: () => Promise<string>;
  onUploaded: () => void;
  onError: (msg: string) => void;
}) {
  const [creating, setCreating] = useState(false);

  if (!importId) {
    return (
      <button
        type="button"
        disabled={creating}
        onClick={async () => {
          setCreating(true);
          try {
            await ensureImport();
          } catch (err) {
            onError((err as Error).message);
          } finally {
            setCreating(false);
          }
        }}
        className="w-full rounded-lg border border-dashed border-hair-2 px-4 py-8 text-sm text-ink-3 hover:border-accent/50 hover:text-ink-2 disabled:opacity-60"
      >
        {creating ? "Starting…" : "Click to start — then upload a document"}
      </button>
    );
  }

  return (
    <UploadZone
      clientId={clientId}
      importId={importId}
      onUploaded={onUploaded}
    />
  );
}
