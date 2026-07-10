"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { FactsReviewForm } from "./facts-review-form";
import { TaxReportView } from "./tax-report-view";

interface Summary {
  taxYear: number;
  status: "extracting" | "needs_review" | "ready" | "failed";
  warningCount: number;
  sourceFilename: string | null;
  updatedAt: string;
}

export interface YearDetail {
  taxYear: number;
  status: Summary["status"];
  facts: TaxReturnFacts | null;
  extractedFacts: TaxReturnFacts | null;
  warnings: string[];
  analysis: TaxAnalysis | null;
  /** True when the stored facts JSON failed to parse — `facts` is null in
   *  that case even though a row exists. Renders a recovery notice instead
   *  of a blank panel. */
  factsParseError?: boolean;
}

export function TaxAnalysisContent({ clientId }: { clientId: string }) {
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [detail, setDetail] = useState<YearDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async (): Promise<Summary[]> => {
    const res = await fetch(`/api/clients/${clientId}/tax-returns`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load tax returns");
    const body = (await res.json()) as { returns: Summary[] };
    setSummaries(body.returns);
    return body.returns;
  }, [clientId]);

  const loadDetail = useCallback(
    async (taxYear: number) => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/clients/${clientId}/tax-returns/${taxYear}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load return detail");
        setDetail((await res.json()) as YearDetail);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setDetailLoading(false);
      }
    },
    [clientId],
  );

  useEffect(() => {
    loadList()
      .then((list) => {
        if (list.length > 0) setSelectedYear(list[0].taxYear);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [loadList]);

  useEffect(() => {
    if (selectedYear != null) void loadDetail(selectedYear);
    else setDetail(null);
  }, [selectedYear, loadDetail]);

  async function upload(file: File, replace = false) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      if (replace) form.set("replace", "true");
      const res = await fetch(`/api/clients/${clientId}/tax-returns`, { method: "POST", body: form });
      const body = await res.json();
      if (res.status === 409) {
        if (window.confirm(`A ${body.taxYear} return already exists. Replace it?`)) {
          await upload(file, true);
        }
        return;
      }
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Extraction failed");
        return;
      }
      const y = body.taxYear as number;
      await loadList();
      if (selectedYear === y) {
        void loadDetail(y); // same year → the [selectedYear] effect won't re-fire; fetch directly
      } else {
        setSelectedYear(y); // different year → effect fires loadDetail
      }
    } finally {
      setUploading(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void upload(file);
    e.target.value = "";
  }

  async function manualEntry(yearRaw: string) {
    setError(null);
    const form = new FormData();
    form.set("manualTaxYear", yearRaw.trim());
    const res = await fetch(`/api/clients/${clientId}/tax-returns`, { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Could not create the year");
      return;
    }
    const y = body.taxYear as number;
    await loadList();
    if (selectedYear === y) {
      void loadDetail(y); // same year → the [selectedYear] effect won't re-fire; fetch directly
    } else {
      setSelectedYear(y); // different year → effect fires loadDetail
    }
  }

  // L3: a corrupted facts row (stored JSON that failed to parse) leaves
  // `facts`/`analysis` null even though the row exists — neither the
  // needs_review nor ready branches below would render anything, so this
  // gives the advisor an explicit recovery path instead of a blank panel.
  async function deleteCorruptYear(taxYear: number) {
    if (!window.confirm(`Delete the ${taxYear} return? You'll need to re-upload it.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tax-returns/${taxYear}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setError(typeof body.error === "string" ? body.error : "Delete failed");
        return;
      }
      await loadList();
      setSelectedYear(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (summaries === null && !error) {
    return <div className="p-8 text-ink-3">Loading tax returns…</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={onPickFile}
      />

      {error && (
        <div className="rounded-lg border border-crit bg-crit/10 p-3 text-sm text-crit">{error}</div>
      )}

      {uploading && (
        <div className="rounded border border-hair bg-card p-6 text-ink-2">
          Analyzing the return — this usually takes under a minute…
        </div>
      )}

      {summaries !== null && summaries.length === 0 && !uploading ? (
        <div className="flex flex-col items-center gap-3 rounded border border-dashed border-hair bg-card p-12 text-center">
          <h2 className="text-lg font-medium text-ink">Upload a filed tax return</h2>
          <p className="max-w-md text-sm text-ink-3">
            Drop in a client&apos;s Form 1040 (PDF or photo). We&apos;ll extract the key figures,
            let you verify them, and generate a client-ready tax report with bracket
            positioning and planning observations.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary h-9 px-5 text-[13px] font-medium disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              Choose file
            </button>
            <button
              type="button"
              className="text-sm text-ink-2 underline disabled:opacity-50"
              disabled={uploading}
              onClick={() => {
                const year = window.prompt("Tax year to enter manually (2022 or later):");
                if (year) void manualEntry(year);
              }}
            >
              Enter manually
            </button>
          </div>
        </div>
      ) : null}

      {summaries !== null && summaries.length > 0 && (
        <>
          <div role="tablist" aria-label="Tax years" className="flex items-center gap-2 border-b border-hair">
            {summaries.map((s) => (
              <button
                key={s.taxYear}
                role="tab"
                aria-selected={selectedYear === s.taxYear}
                className={`px-3 py-2 text-sm ${selectedYear === s.taxYear ? "border-b-2 border-accent font-medium text-ink" : "text-ink-3"}`}
                onClick={() => setSelectedYear(s.taxYear)}
              >
                {s.taxYear}
                {s.status === "needs_review" ? " · review" : ""}
              </button>
            ))}
            <button
              type="button"
              className="ml-auto px-3 py-2 text-sm text-ink-2 underline disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              Add year
            </button>
          </div>

          {detailLoading && <div className="p-8 text-ink-3">Loading {selectedYear}…</div>}

          {!detailLoading && detail?.factsParseError && !detail.facts && (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-crit bg-crit/10 p-6">
              <h2 className="text-sm font-semibold text-crit">
                This year&apos;s data couldn&apos;t be read
              </h2>
              <p className="max-w-md text-sm text-ink-2">
                The saved data for {detail.taxYear} is corrupted and can&apos;t be displayed.
                Delete this year and re-upload the return to fix it.
              </p>
              <button
                type="button"
                className="rounded border border-crit bg-crit/10 px-4 py-2 text-sm font-medium text-crit transition-colors hover:bg-crit/20"
                onClick={() => void deleteCorruptYear(detail.taxYear)}
              >
                Delete &amp; re-upload
              </button>
            </div>
          )}

          {!detailLoading && detail?.status === "needs_review" && detail.facts && (
            <FactsReviewForm
              clientId={clientId}
              detail={detail}
              onSaved={() => {
                void loadList();
                void loadDetail(detail.taxYear);
              }}
            />
          )}

          {!detailLoading && detail?.status === "ready" && detail.analysis && (
            <TaxReportView
              clientId={clientId}
              detail={detail}
              onEditFacts={async () => {
                // C1: reopen the year (ready → needs_review) via the Task 12
                // PUT endpoint, then re-fetch so the FactsReviewForm branch
                // above picks it up and the tab's "· review" marker updates.
                await fetch(`/api/clients/${clientId}/tax-returns/${detail.taxYear}`, {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ facts: detail.facts, reopen: true }),
                });
                void loadList();
                void loadDetail(detail.taxYear);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
