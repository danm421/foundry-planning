"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import type { DivorceDisposition } from "@/lib/divorce/allocation-rules";
import type { CommitPreview } from "@/lib/divorce/commit-preview";
import type { CommitResult } from "@/lib/divorce/commit-divorce-plan";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type CleanupRow = CommitPreview["cleanup"][number];
/** The persisted checklist decision the settings PATCH carries — the row's
 *  identity plus whether the advisor wants it removed on commit. */
export type CleanupSelection = Pick<CleanupRow, "source" | "id" | "remove">;

/** The three non-primary dispositions, grouped for the actions summary. The
 *  preview never lists `primary` moves (nothing changes for them). */
const ACTION_GROUPS: Array<{
  disposition: Exclude<DivorceDisposition, "primary">;
  heading: (spouse: string) => string;
}> = [
  { disposition: "spouse", heading: (s) => `Moving to ${s}` },
  { disposition: "split", heading: () => "Splitting between households" },
  { disposition: "duplicate", heading: () => "Copied to both households" },
];

export interface CommitPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  people: { primaryName: string; spouseName: string };
  /** Threads a checklist toggle to the shell's settings PATCH (which reconciles
   *  only `plan`, keeping the allocations PUT invariant intact). Always the full
   *  selection set, never a delta. */
  onCleanupChange: (selections: CleanupSelection[]) => void;
  /** Fires once, on a 200 commit — the shell swaps in the success state. */
  onCommitted: (result: CommitResult) => void;
}

type Step = "preview" | "confirm";

export function CommitPreviewDialog({
  open,
  onOpenChange,
  clientId,
  people,
  onCleanupChange,
  onCommitted,
}: CommitPreviewDialogProps) {
  const [step, setStep] = useState<Step>("preview");
  const [preview, setPreview] = useState<CommitPreview | null>(null);
  const [cleanup, setCleanup] = useState<CleanupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const spouseName = people.spouseName.trim() || "the spouse";
  const primaryName = people.primaryName.trim() || "the primary";
  const spouseFirst = people.spouseName.trim().split(/\s+/)[0] || "Spouse";

  // Load the preview on open; reset every step/field so a reopen is clean.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("preview");
    setConfirmText("");
    setCommitError(null);
    setPreview(null);
    setCleanup([]);
    setPreviewError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/divorce-plan/preview`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        const data = (await res.json()) as CommitPreview;
        if (cancelled) return;
        setPreview(data);
        setCleanup(data.cleanup);
      } catch {
        if (!cancelled) setPreviewError("Could not load the commit preview. Close this and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  const blockers = preview?.blockers ?? [];
  const hasBlockers = blockers.length > 0;
  const nameMatches =
    confirmText.trim().length > 0 &&
    confirmText.trim().toLowerCase() === spouseFirst.toLowerCase();

  const toggleCleanup = useCallback(
    (id: string, source: CleanupRow["source"]) => {
      // Compute the next set from the current snapshot (keep the setState
      // updater pure — no callback side-effects inside it), then persist the
      // full selection set through the shell's settings PATCH.
      const next = cleanup.map((r) =>
        r.id === id && r.source === source ? { ...r, remove: !r.remove } : r,
      );
      setCleanup(next);
      onCleanupChange(next.map(({ source: s, id: i, remove }) => ({ source: s, id: i, remove })));
    },
    [cleanup, onCleanupChange],
  );

  const doCommit = useCallback(async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/divorce-plan/commit`, {
        method: "POST",
      });
      if (res.ok) {
        const result = (await res.json()) as CommitResult;
        onCommitted(result);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        blockers?: CommitPreview["blockers"];
        message?: string;
      };
      if (res.status === 422 && body.error === "blocked") {
        // The commit re-validated and found unresolved preconditions — surface
        // the returned checklist and send the advisor back to fix them.
        setPreview((p) => (p ? { ...p, blockers: body.blockers ?? [] } : p));
        setStep("preview");
        return;
      }
      if (res.status === 422 && body.message) {
        // unresolvable_measuring_life — the message names the trust + the fix.
        setCommitError(body.message);
        return;
      }
      if (res.status === 409) {
        setCommitError("Commit already in progress.");
        return;
      }
      setCommitError("Something went wrong. Close this and try again.");
    } catch {
      setCommitError("Something went wrong. Close this and try again.");
    } finally {
      setCommitting(false);
    }
  }, [clientId, onCommitted]);

  const actionGroups = useMemo(() => {
    const actions = preview?.actions ?? [];
    return ACTION_GROUPS.map((g) => ({
      ...g,
      items: actions.filter((a) => a.disposition === g.disposition),
    })).filter((g) => g.items.length > 0);
  }, [preview]);

  const isPreviewStep = step === "preview";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={isPreviewStep ? "Review the split" : "Confirm the split"}
      size="lg"
      contentFill
      primaryAction={
        isPreviewStep
          ? {
              label: "Continue",
              disabled: loading || !preview || hasBlockers,
              onClick: () => setStep("confirm"),
            }
          : undefined
      }
      secondaryAction={
        isPreviewStep
          ? undefined
          : { label: "Back", onClick: () => setStep("preview"), disabled: committing }
      }
      destructiveAction={
        isPreviewStep
          ? undefined
          : {
              label: committing ? "Creating…" : "Create separate household",
              disabled: !nameMatches || committing,
              onClick: doCommit,
            }
      }
    >
      {isPreviewStep ? (
        <PreviewStep
          loading={loading}
          previewError={previewError}
          preview={preview}
          cleanup={cleanup}
          primaryName={primaryName}
          spouseName={spouseName}
          spouseFirst={spouseFirst}
          actionGroups={actionGroups}
          onToggleCleanup={toggleCleanup}
        />
      ) : (
        <ConfirmStep
          spouseFirst={spouseFirst}
          spouseName={spouseName}
          confirmText={confirmText}
          onConfirmText={setConfirmText}
          committing={committing}
          commitError={commitError}
        />
      )}
    </DialogShell>
  );
}

function PreviewStep({
  loading,
  previewError,
  preview,
  cleanup,
  primaryName,
  spouseName,
  spouseFirst,
  actionGroups,
  onToggleCleanup,
}: {
  loading: boolean;
  previewError: string | null;
  preview: CommitPreview | null;
  cleanup: CleanupRow[];
  primaryName: string;
  spouseName: string;
  spouseFirst: string;
  actionGroups: Array<{
    disposition: string;
    heading: (spouse: string) => string;
    items: CommitPreview["actions"];
  }>;
  onToggleCleanup: (id: string, source: CleanupRow["source"]) => void;
}) {
  if (loading) {
    return <p className="text-[13px] text-ink-3">Building the commit preview…</p>;
  }
  if (previewError) {
    return <p className="text-[13px] text-crit">{previewError}</p>;
  }
  if (!preview) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Blockers — must be cleared before the split can be committed. */}
      {preview.blockers.length > 0 && (
        <section className="rounded-[var(--radius)] border border-crit/30 bg-crit/10 p-4">
          <h3 className="text-[13px] font-semibold text-crit">Resolve before committing</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {preview.blockers.map((b) => (
              <li key={b.code} className="flex items-start gap-2 text-[13px] text-ink-2">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-crit" />
                {b.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Side-by-side final totals. */}
      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-4">
          Final totals
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <TotalsCard name={preview.totals.primary.name || primaryName} totals={preview.totals.primary} />
          <TotalsCard name={preview.totals.spouse.name || spouseName} totals={preview.totals.spouse} />
        </div>
      </section>

      {/* What the commit will do, grouped by disposition in plain language. */}
      {actionGroups.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-4">
            What changes
          </h3>
          <div className="flex flex-col gap-4">
            {actionGroups.map((g) => (
              <div key={g.disposition}>
                <p className="text-[12px] font-medium text-ink-2">{g.heading(spouseName)}</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {g.items.map((a) => (
                    <li
                      key={`${a.kind}:${a.id}`}
                      className="flex items-baseline justify-between gap-3 text-[13px]"
                    >
                      <span className="text-ink">{a.label}</span>
                      <span className="tabular shrink-0 text-[12px] text-ink-3">{a.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Warnings — links that straddle the two households, dropped on commit. */}
      {preview.warnings.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-4">
            Dropped on commit
          </h3>
          <ul className="flex flex-col gap-1.5">
            {preview.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="text-[13px] text-warn">
                <span className="font-medium">{w.label}</span>
                <span className="text-ink-3"> — {w.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cleanup checklist — spouse-naming designations to strike on commit. */}
      {cleanup.length > 0 && (
        <section>
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-4">
            Beneficiary cleanup
          </h3>
          <p className="mb-2 text-[12px] text-ink-3">
            Checked items are removed from the household they land on when you commit.
          </p>
          <ul className="flex flex-col gap-1.5">
            {cleanup.map((c) =>
              c.forced ? (
                // Structurally forced: the designation rides on the departing
                // spouse's family record, so it's removed on commit no matter
                // what — render it read-only, not as a live choice.
                <li key={`${c.source}:${c.id}`} className="flex flex-col gap-0.5">
                  <div className="flex items-start gap-2.5 text-[13px] text-ink-3">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      readOnly
                      aria-label={c.label}
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span>{c.label}</span>
                  </div>
                  <span className="pl-[26px] text-[11px] text-ink-4">
                    {`Removed with ${spouseFirst}'s family record`}
                  </span>
                </li>
              ) : (
                <li key={`${c.source}:${c.id}`}>
                  <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={c.remove}
                      onChange={() => onToggleCleanup(c.id, c.source)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    {c.label}
                  </label>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {/* Informational — what stays with the primary household. */}
      {preview.informational.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-4">
            Stays in place
          </h3>
          <ul className="flex flex-col gap-1">
            {preview.informational.map((line, i) => (
              <li key={i} className="text-[13px] text-ink-3">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TotalsCard({
  name,
  totals,
}: {
  name: string;
  totals: { netWorth: number; annualIncome: number; annualExpenses: number };
}) {
  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card-2 p-4">
      <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
      <dl className="mt-3 flex flex-col gap-2">
        <TotalRow label="Net worth" value={totals.netWorth} />
        <TotalRow label="Income" value={totals.annualIncome} />
        <TotalRow label="Expenses" value={totals.annualExpenses} />
      </dl>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="tabular text-[13px] text-ink">{currency.format(value)}</dd>
    </div>
  );
}

function ConfirmStep({
  spouseFirst,
  spouseName,
  confirmText,
  onConfirmText,
  committing,
  commitError,
}: {
  spouseFirst: string;
  spouseName: string;
  confirmText: string;
  onConfirmText: (v: string) => void;
  committing: boolean;
  commitError: string | null;
}) {
  return (
    <div className="flex max-w-prose flex-col gap-4">
      <p className="text-[14px] leading-relaxed text-ink-2">
        Type <span className="font-semibold text-ink">{spouseFirst}</span> to confirm. This creates
        a separate household for {spouseName} and cannot be undone.
      </p>
      <div>
        <label htmlFor="divorce-commit-confirm" className="sr-only">
          Type {spouseFirst} to confirm
        </label>
        <input
          id="divorce-commit-confirm"
          type="text"
          autoComplete="off"
          value={confirmText}
          disabled={committing}
          onChange={(e) => onConfirmText(e.target.value)}
          placeholder={spouseFirst}
          className="h-9 w-full rounded-[var(--radius-sm)] border border-hair bg-card px-3 text-[14px] text-ink outline-none placeholder:text-ink-4 focus:border-hair-2 disabled:opacity-50"
        />
      </div>
      {commitError && <p className="text-[13px] text-crit">{commitError}</p>}
    </div>
  );
}
