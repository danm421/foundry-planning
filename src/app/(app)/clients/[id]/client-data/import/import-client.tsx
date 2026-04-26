"use client";

import { useState, useCallback } from "react";
import UploadZone from "@/components/import/upload-zone";
import type { QueuedFile } from "@/components/import/upload-zone";
import ExtractionProgress from "@/components/import/extraction-progress";
import type { FileProgress } from "@/components/import/extraction-progress";
import ReviewWizard from "@/components/import/review-wizard";
import type { ExtractionResult } from "@/lib/extraction/types";

type Phase = "upload" | "extracting" | "review";

interface ImportPageClientProps {
  clientId: string;
  existingAccountNames: string[];
  defaultStartYear: number;
  defaultEndYear: number;
}

export default function ImportPageClient({
  clientId,
  existingAccountNames,
  defaultStartYear,
  defaultEndYear,
}: ImportPageClientProps) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [model, setModel] = useState<"mini" | "full">("mini");
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [results, setResults] = useState<ExtractionResult[]>([]);

  const handleExtract = useCallback(async () => {
    if (queuedFiles.length === 0) return;

    setPhase("extracting");
    const fileProgress: FileProgress[] = queuedFiles.map((qf) => ({
      id: qf.id,
      fileName: qf.file.name,
      status: "queued" as const,
    }));
    setProgress(fileProgress);

    const extractionResults: ExtractionResult[] = [];

    // Process files sequentially
    for (let i = 0; i < queuedFiles.length; i++) {
      const qf = queuedFiles[i];

      setProgress((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: "extracting" } : p))
      );

      try {
        const formData = new FormData();
        formData.append("file", qf.file);
        formData.append("documentType", qf.detectedType);
        formData.append("model", model);

        const resp = await fetch(`/api/clients/${clientId}/extract`, {
          method: "POST",
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Extraction failed" }));
          throw new Error(err.error ?? "Extraction failed");
        }

        const result: ExtractionResult = await resp.json();
        extractionResults.push(result);

        setProgress((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: "done" } : p))
        );
      } catch (err) {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed" }
              : p
          )
        );
      }
    }

    setResults(extractionResults);

    if (extractionResults.length > 0) {
      setTimeout(() => setPhase("review"), 800);
    }
  }, [queuedFiles, model, clientId]);

  const handleRetry = useCallback(
    async (fileId: string) => {
      const qf = queuedFiles.find((f) => f.id === fileId);
      if (!qf) return;

      setProgress((prev) =>
        prev.map((p) => (p.id === fileId ? { ...p, status: "extracting", error: undefined } : p))
      );

      try {
        const formData = new FormData();
        formData.append("file", qf.file);
        formData.append("documentType", qf.detectedType);
        formData.append("model", model);

        const resp = await fetch(`/api/clients/${clientId}/extract`, {
          method: "POST",
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Extraction failed" }));
          throw new Error(err.error ?? "Extraction failed");
        }

        const result: ExtractionResult = await resp.json();
        setResults((prev) => [...prev, result]);

        setProgress((prev) =>
          prev.map((p) => (p.id === fileId ? { ...p, status: "done" } : p))
        );
      } catch (err) {
        setProgress((prev) =>
          prev.map((p) =>
            p.id === fileId
              ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed" }
              : p
          )
        );
      }
    },
    [queuedFiles, model, clientId]
  );

  const handleReset = useCallback(() => {
    setPhase("upload");
    setQueuedFiles([]);
    setProgress([]);
    setResults([]);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-100">Import Documents</h2>

      {phase === "upload" && (
        <>
          <UploadZone onFilesQueued={setQueuedFiles} />

          {queuedFiles.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-300">Model:</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as "mini" | "full")}
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
                >
                  <option value="mini">Fast (GPT 5.4 Mini)</option>
                  <option value="full">Detailed (GPT 5.4)</option>
                </select>
              </div>

              <button
                onClick={handleExtract}
                className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Extract ({queuedFiles.length} file{queuedFiles.length !== 1 ? "s" : ""})
              </button>
            </div>
          )}
        </>
      )}

      {phase === "extracting" && (
        <ExtractionProgress files={progress} onRetry={handleRetry} />
      )}

      {phase === "review" && (
        <ReviewWizard
          clientId={clientId}
          results={results}
          existingAccountNames={existingAccountNames}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
