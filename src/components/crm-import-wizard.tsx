"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  DownloadIcon,
} from "@/components/icons";
import { CrmImportPreview, type Decision } from "@/components/crm-import-preview";
import type { DryRunResult } from "@/lib/crm/import";

// Wizard step machine — kept as a single component because the three
// states share too much (file, dry-run result, decisions) to make a
// router or sub-component split worthwhile.
type Step = "upload" | "preview" | "result";

// Canonical upload columns, in the exact order the parser requires. Kept
// in lockstep with `IMPORT_COLUMNS` in @/lib/crm/import — duplicated here
// (rather than imported) because that module pulls in server-only deps
// (xlsx, audit, db) that can't ship to the client. The parser rejects any
// header that drifts from this order, so a mismatch fails loudly, not
// silently. Both the on-screen doc and the downloadable template render
// from this single list.
const TEMPLATE_COLUMNS = [
  "household_name",
  "primary_first",
  "primary_last",
  "primary_email",
  "primary_phone",
  "primary_dob",
  "spouse_first",
  "spouse_last",
  "spouse_email",
  "spouse_dob",
  "advisor_id",
  "status",
  "notes",
  "address_line1",
  "city",
  "state",
  "postal_code",
] as const;

// One illustrative row so the template documents the expected formats
// (ISO `YYYY-MM-DD` dates, the `prospect`/`active`/`inactive`/`archived`
// status set, the Clerk advisor id). The mandatory Review step catches it
// if an advisor forgets to delete it before committing.
const TEMPLATE_SAMPLE_ROW = [
  "The Sample Household",
  "Jordan",
  "Sample",
  "jordan.sample@example.com",
  "555-0100",
  "1970-01-15",
  "Riley",
  "Sample",
  "riley.sample@example.com",
  "1972-06-30",
  "user_REPLACE_WITH_ADVISOR_ID",
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
  const csv = `${TEMPLATE_COLUMNS.join(",")}\n${TEMPLATE_SAMPLE_ROW.map(csvCell).join(",")}\n`;
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

// Re-export so existing consumers (crm-import-preview.tsx) keep the
// import path stable; the canonical definition lives in @/lib/crm/import.
export type { DryRunResult };

export function CrmImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [committed, setCommitted] = useState<{
    created: number;
    skipped: number;
  } | null>(null);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file first.");
      setSubmitting(false);
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/crm/import/preview", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as
        | DryRunResult
        | { error?: unknown };
      if (!res.ok) {
        const msg =
          "error" in json && typeof json.error === "string"
            ? json.error
            : `Preview failed (${res.status})`;
        throw new Error(msg);
      }
      const result = json as DryRunResult;
      setDryRun(result);
      // Default decision per duplicate row → skip the first matched
      // candidate. Advisor can flip any row to "create" before committing.
      const defaults: Decision[] = [
        ...result.rowsToCreate.map<Decision>((row) => ({
          action: "create",
          row,
        })),
        ...result.duplicates.map<Decision>((d) => ({
          action: "skip",
          row: d.row,
          matchedHouseholdId: d.matches[0]?.id ?? "",
        })),
      ];
      setDecisions(defaults);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onCommit() {
    if (!dryRun) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions }),
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
            <p className="text-[13px] text-ink-2">
              CSV columns (header row required, exact order):
            </p>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
            >
              <DownloadIcon width={14} height={14} aria-hidden="true" />
              Download template
            </button>
          </div>
          <pre className="overflow-x-auto rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3 text-[12px] text-ink-3">
            {TEMPLATE_COLUMNS.join(", ")}
          </pre>
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

      {step === "preview" && dryRun && (
        <div className="space-y-5">
          <CrmImportPreview
            dryRun={dryRun}
            decisions={decisions}
            onChange={setDecisions}
          />
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setStep("upload");
                setDryRun(null);
                setDecisions([]);
              }}
              className="text-[13px] text-ink-3 transition-colors hover:text-ink-2"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={onCommit}
              disabled={submitting || decisions.length === 0}
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
                setStep("upload");
                setDryRun(null);
                setDecisions([]);
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
