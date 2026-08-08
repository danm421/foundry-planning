"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  DownloadIcon,
} from "@/components/icons";
import { CrmImportFixes } from "@/components/crm-import-fixes";
import { CrmImportMapping } from "@/components/crm-import-mapping";
import { CrmImportPreview, resolve } from "@/components/crm-import-preview";
import {
  TEMPLATE_HEADERS,
  missingRequiredFields,
  type ColumnMapping,
} from "@/lib/crm/import/columns";
import type { ParsedRow, RowOverride } from "@/lib/crm/import/rows";

// Wizard step machine — kept as a single component because the three
// states share too much (uploaded file, mapping, preview, choices) to make
// a router or sub-component split worthwhile.
type Step = "upload" | "preview" | "result";

// Mirror of PreviewResult in @/lib/crm/import/preview — re-declared because
// that module reaches the db for the dedup corpus and can't ship to the client.
export type DuplicateMatch = { id: string; name: string; score: number };
export type PreviewResult = {
  rows: ParsedRow[];
  duplicates: { rowIndex: number; matches: DuplicateMatch[] }[];
  partialDedupCorpus: boolean;
  truncated: boolean;
};

// One illustrative row so the template documents the expected formats
// (ISO `YYYY-MM-DD` dates, the `prospect`/`active`/`inactive`/`archived`
// status set). The mandatory Review step catches it if an advisor forgets
// to delete it before committing.
const TEMPLATE_SAMPLE_ROW = [
  "",                       // household_name — leave blank to auto-name "Jordan & Riley Sample"
  "Jordan",
  "Sample",
  "jordan.sample@example.com",
  "555-0100",
  "1970-01-15",
  "Riley",
  "Sample",
  "riley.sample@example.com",
  "1972-06-30",
  "prospect",
  "Delete this example row before importing",
  "123 Main St",
  "Springfield",
  "IL",
  "62704",
] as const;

// RFC-4180 escaping: quote any cell containing a comma, quote, or newline,
// and double embedded quotes.
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS.join(",")}\n${TEMPLATE_SAMPLE_ROW.map(csvCell).join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "foundry-crm-import-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CrmImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{
    header: string[];
    dataRows: (string | number)[][];
  } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [overrides, setOverrides] = useState<RowOverride[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [committed, setCommitted] = useState<{
    created: number;
    skipped: number;
  } | null>(null);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const selected = data.get("file");
    if (!(selected instanceof File) || selected.size === 0) {
      setError("Choose a CSV file first.");
      setSubmitting(false);
      return;
    }
    const fd = new FormData();
    fd.append("file", selected);
    try {
      const res = await fetch("/api/crm/import/preview", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as
        | {
            file: { header: string[]; dataRows: (string | number)[][] };
            mapping: ColumnMapping;
            preview: PreviewResult;
          }
        | { error?: unknown };
      if (!res.ok) {
        const msg =
          "error" in json && typeof json.error === "string"
            ? json.error
            : `Preview failed (${res.status})`;
        throw new Error(msg);
      }
      const result = json as {
        file: { header: string[]; dataRows: (string | number)[][] };
        mapping: ColumnMapping;
        preview: PreviewResult;
      };
      setFile(result.file);
      setMapping(result.mapping);
      setOverrides([]);
      setChoices({});
      setPreview(result.preview);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Re-derive the preview server-side whenever the mapping or an inline fix
  // changes. Debounced on blur by the callers, not per keystroke — the remap
  // endpoint is rate-limited at 60/min.
  const refresh = useCallback(
    async (nextMapping: ColumnMapping, nextOverrides: RowOverride[]) => {
      if (!file) return;
      setRefreshing(true);
      setError(null);
      try {
        const res = await fetch("/api/crm/import/remap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dataRows: file.dataRows,
            mapping: nextMapping,
            overrides: nextOverrides,
          }),
        });
        if (!res.ok) throw new Error(`Could not rebuild the preview (${res.status})`);
        const json = (await res.json()) as { preview: PreviewResult };
        setPreview((prev) => ({
          ...json.preview,
          // Upload capped the grid at MAX_IMPORT_ROWS; remap only ever sees the
          // already-capped rows and always reports false. Keep the warning sticky.
          truncated: json.preview.truncated || (prev?.truncated ?? false),
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not rebuild the preview");
      } finally {
        setRefreshing(false);
      }
    },
    [file],
  );

  // Single reset path for the step state so a future field added to the
  // wizard only needs updating here, not at every "start over" call site.
  function resetWizard() {
    setStep("upload");
    setFile(null);
    setMapping({});
    setOverrides([]);
    setPreview(null);
    setChoices({});
  }

  function buildDecisions() {
    if (!preview) return [];
    // Delegates to the same `resolve` the preview table renders from, so a
    // blocked/create/skip outcome can never differ between what the advisor
    // saw and what gets posted. Excluding "blocked" here is load-bearing:
    // the commit route rejects the entire batch with a 400 if a single
    // errored row reaches it.
    return preview.rows.flatMap((r) => {
      const dup = preview.duplicates.find((d) => d.rowIndex === r.rowIndex);
      const resolved = resolve(r, dup?.matches, choices);
      if (resolved.kind === "blocked") return [];
      const row = { household: r.household, primary: r.primary, spouse: r.spouse };
      const decision =
        resolved.kind === "create"
          ? { action: "create" as const, row }
          : { action: "skip" as const, row, matchedHouseholdId: resolved.householdId };
      return [decision];
    });
  }

  async function onCommit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions: buildDecisions() }),
      });
      const json = (await res.json().catch(() => ({}))) as
        | { created: number; skipped: number }
        | { error?: unknown };
      if (!res.ok) {
        const msg =
          "error" in json && typeof json.error === "string"
            ? json.error
            : `Commit failed (${res.status})`;
        throw new Error(msg);
      }
      setCommitted(json as { created: number; skipped: number });
      setStep("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setSubmitting(false);
    }
  }

  const importableCount = preview?.rows.filter((r) => r.errors.length === 0).length ?? 0;
  const missingRequired = missingRequiredFields(mapping);

  return (
    <section className="rounded-[10px] border border-hair bg-card p-6 sm:p-7">
      <Stepper step={step} />

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon
            width={16}
            height={16}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {step === "upload" && (
        <form onSubmit={onUpload} className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-ink-2">
              <p className="font-medium text-ink">Upload any client list.</p>
              <p className="mt-1 text-ink-3">
                Column order doesn&apos;t matter and extra columns are ignored — you&apos;ll
                confirm how they map on the next step. Only a first and last name are
                required; household names are generated for you.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
            >
              <DownloadIcon width={14} height={14} aria-hidden="true" />
              Download template
            </button>
          </div>
          <div>
            <label
              className="block mb-1.5 text-[13px] font-medium text-ink-2"
              htmlFor="file"
            >
              CSV file
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,.xlsx,.xls"
              required
              className="block w-full text-[13px] text-ink-2 file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-accent-on hover:file:bg-accent-deep"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink disabled:opacity-60"
            >
              {submitting ? "Parsing…" : "Preview import"}
              <ArrowRightIcon width={14} height={14} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}

      {step === "preview" && preview && (
        <div className="space-y-5">
          {file && (
            <CrmImportMapping
              header={file.header}
              mapping={mapping}
              onChange={(next) => {
                setMapping(next);
                void refresh(next, overrides);
              }}
            />
          )}
          {preview && (
            <CrmImportFixes
              rows={preview.rows}
              overrides={overrides}
              onCommitEdit={(next) => {
                setOverrides(next);
                void refresh(mapping, next);
              }}
            />
          )}
          <CrmImportPreview preview={preview} choices={choices} onChange={setChoices} />
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={resetWizard}
              className="text-[13px] text-ink-3 transition-colors hover:text-ink-2"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={onCommit}
              disabled={submitting || refreshing || importableCount === 0 || missingRequired.length > 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink disabled:opacity-60"
            >
              {submitting ? "Importing…" : "Commit import"}
              <ArrowRightIcon width={14} height={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {step === "result" && committed && (
        <div className="space-y-4 text-[14px] text-ink-2">
          <p>
            <strong className="text-ink">{committed.created}</strong> household
            {committed.created === 1 ? "" : "s"} created.{" "}
            <strong className="text-ink">{committed.skipped}</strong> skipped.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/crm"
              className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink"
            >
              Back to CRM
            </Link>
            <button
              type="button"
              onClick={() => {
                resetWizard();
                setCommitted(null);
              }}
              className="text-[13px] text-ink-3 transition-colors hover:text-ink-2"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ["upload", "preview", "result"];
  const labels: Record<Step, string> = {
    upload: "1. Upload",
    preview: "2. Review",
    result: "3. Done",
  };
  const currentIdx = order.indexOf(step);
  return (
    <ol className="mb-6 flex items-center gap-2 text-[12px] uppercase tracking-wider text-ink-3">
      {order.map((s, i) => {
        const active = i === currentIdx;
        const done = i < currentIdx;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={
                active
                  ? "text-accent"
                  : done
                    ? "text-ink-2"
                    : "text-ink-4"
              }
            >
              {labels[s]}
            </span>
            {i < order.length - 1 && <span className="text-ink-4">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
