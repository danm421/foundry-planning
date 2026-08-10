"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { DocumentSummary } from "@/lib/tax-returns/assemble-analysis";
import type { FieldConflict } from "@/lib/tax-returns/merge/types";
import type { SecondRead } from "@/lib/tax-returns/second-read/types";
import { FactsReviewForm } from "./facts-review-form";
import { TaxReportView } from "./tax-report-view";
import { DocumentsStrip } from "./documents-strip";

/** Both `message` (documents endpoints) and `error` (year endpoints) show up
 *  across these routes' failure bodies; a response can also fail to parse as
 *  JSON at all (a 413, or an HTML 500 page). Always resolves — never throws —
 *  so every caller's `setError` is reached instead of an uncaught rejection
 *  silently returning the UI to idle. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}) as { message?: string; error?: string });
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  return fallback;
}

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
  documents: DocumentSummary[];
  conflicts: FieldConflict[];
  provenance: Record<string, string>;
  /** True only in the deploy-before-migrate window — see `documents-strip.tsx`. */
  documentsUnavailable?: boolean;
  /** Null when none was ever generated, or when the stored blob failed
   *  re-validation — either way the panel offers to run one rather than
   *  taking the tab down. */
  secondRead?: SecondRead | null;
  /** The documents (or the prompt) changed since the read was generated. A
   *  stale read is still rendered — it is still information. */
  secondReadStale?: boolean;
}

export function TaxAnalysisContent({ clientId }: { clientId: string }) {
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [detail, setDetail] = useState<YearDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [secondReadBusy, setSecondReadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept separate from `error` so it can render INSIDE the panel. The shared
  // banner is the first child of this container and the panel is its last
  // element, so a second-read failure routed through `setError` lands
  // thousands of pixels above the button the advisor just pressed.
  const [secondReadError, setSecondReadError] = useState<string | null>(null);
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

  // Shared by upload() and manualEntry(): after either creates/replaces a
  // year, refresh the tab list, then either re-fetch the detail directly
  // (same year → the [selectedYear] effect above won't re-fire) or switch
  // the selected year (different year → that effect fires loadDetail).
  const selectYearAfterMutation = useCallback(
    async (y: number) => {
      await loadList();
      if (selectedYear === y) {
        void loadDetail(y);
      } else {
        setSelectedYear(y);
      }
    },
    [selectedYear, loadList, loadDetail],
  );

  async function upload(file: File, replace = false) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      if (replace) form.set("replace", "true");
      const res = await fetch(`/api/clients/${clientId}/tax-returns`, { method: "POST", body: form });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { taxYear?: number };
        if (window.confirm(`A ${body.taxYear} return already exists. Replace it?`)) {
          await upload(file, true);
        }
        return;
      }
      if (!res.ok) {
        setError(await errorMessage(res, "Extraction failed"));
        return;
      }
      const body = (await res.json()) as { taxYear: number };
      await selectYearAfterMutation(body.taxYear);
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
    if (!res.ok) {
      setError(await errorMessage(res, "Could not create the year"));
      return;
    }
    const body = (await res.json()) as { taxYear: number };
    await selectYearAfterMutation(body.taxYear);
  }

  async function addDocument(file: File, role: string) {
    if (selectedYear == null) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("role", role);
      const res = await fetch(
        `/api/clients/${clientId}/tax-returns/${selectedYear}/documents`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        setError(await errorMessage(res, "Couldn't add the document"));
        return;
      }
      await loadList();
      void loadDetail(selectedYear);
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(documentId: string) {
    if (selectedYear == null) return;
    setError(null);
    const res = await fetch(
      `/api/clients/${clientId}/tax-returns/${selectedYear}/documents/${documentId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setError(await errorMessage(res, "Couldn't remove the document"));
      return;
    }
    await loadList();
    void loadDetail(selectedYear);
  }

  // Both second-read handlers patch `detail` in place from the response rather
  // than re-fetching the year: a second read changes nothing else on the page,
  // and `loadDetail` would re-run the whole analysis for one panel.
  //
  // Both therefore pin the year they were started for and merge only if that
  // year is still the one on screen. The generate call can take a minute, the
  // year tabs stay live throughout, and merging 2025's transcriptions into
  // 2024's panel — flagged `secondReadStale: false`, i.e. "current" — is the
  // worst failure available to a lane whose whole premise is "check this
  // against the form".
  //
  // Both also catch a REJECTED fetch, not just a non-ok response. This route
  // allows 300s and the panel says the read can take a minute, so a browser or
  // proxy timeout is an ordinary outcome — and an unhandled rejection would
  // return the panel to idle looking exactly like a successful empty read.
  async function runSecondRead() {
    const year = selectedYear;
    if (year == null) return;
    setSecondReadBusy(true);
    setSecondReadError(null);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tax-returns/${year}/second-read`,
        { method: "POST" },
      );
      if (!res.ok) {
        // The 403 entitlement body carries a machine code, not prose — every
        // other failure body on this route is already a sentence.
        const message = await errorMessage(res, "The second read couldn't run");
        setSecondReadError(
          message === "ai_import_not_entitled"
            ? "AI features aren't enabled for this firm."
            : message,
        );
        return;
      }
      const body = (await res.json()) as { secondRead: SecondRead };
      setDetail((d) =>
        d && d.taxYear === year
          ? { ...d, secondRead: body.secondRead, secondReadStale: false }
          : d,
      );
    } catch (e) {
      setSecondReadError(e instanceof Error ? e.message : "The second read couldn't run");
    } finally {
      setSecondReadBusy(false);
    }
  }

  async function dismissSecondReadItem(itemId: string) {
    const year = selectedYear;
    if (year == null) return;
    setSecondReadError(null);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tax-returns/${year}/second-read/${itemId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setSecondReadError(await errorMessage(res, "Couldn't dismiss that item"));
        return;
      }
      const body = (await res.json()) as { secondRead: SecondRead };
      setDetail((d) => (d && d.taxYear === year ? { ...d, secondRead: body.secondRead } : d));
    } catch (e) {
      setSecondReadError(e instanceof Error ? e.message : "Couldn't dismiss that item");
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
            positioning and planning findings.
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

          {detail && !detailLoading && (
            <DocumentsStrip
              documents={detail.documents ?? []}
              unavailable={detail.documentsUnavailable ?? false}
              busy={uploading}
              onAdd={(file, role) => void addDocument(file, role)}
              onRemove={(id) => void removeDocument(id)}
            />
          )}

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
              key={detail.taxYear}
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
              secondReadBusy={secondReadBusy}
              secondReadError={secondReadError}
              onRunSecondRead={() => void runSecondRead()}
              onDismissSecondReadItem={(itemId) => void dismissSecondReadItem(itemId)}
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
