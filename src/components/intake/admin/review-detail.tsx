"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntakeFormRow } from "@/lib/intake/queries";
import { intakeDocTypeLabel, type IntakeDocumentView } from "@/lib/intake/document-types";
import { formatBytes } from "@/components/portal/documents/vault-format";
import type { IntakeDiff, FieldDiff, ListSectionDiff } from "./diff-utils";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";

// ── Helpers ───────────────────────────────────────────────────────────────────

const labelCls = "block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

function formatMoney(n: number | undefined): string {
  if (n === undefined) return "—";
  return `$${n.toLocaleString()}`;
}

function displayValue(v: string | number | undefined): string {
  if (v === undefined || v === null) return "—";
  return String(v);
}

// ── FieldRow ──────────────────────────────────────────────────────────────────

function FieldRow({
  label,
  diff,
  format,
}: {
  label: string;
  diff: FieldDiff<string | number | undefined>;
  format?: (v: string | number | undefined) => string;
}) {
  const fmt = format ?? displayValue;
  if (!diff.changed) {
    const val = fmt(diff.value);
    return (
      <div className="flex items-center justify-between gap-4 py-1 text-[14px]">
        <span className="text-ink-3">{label}</span>
        <span className="tabular text-ink-2">{val}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-[14px]">
      <span className="text-ink-3">{label}</span>
      <span className="flex items-center gap-2">
        {diff.old !== undefined && (
          <span className="tabular text-ink-4 line-through">{fmt(diff.old)}</span>
        )}
        <span className="tabular font-medium text-ink">{fmt(diff.new)}</span>
      </span>
    </div>
  );
}

// ── ListSection ───────────────────────────────────────────────────────────────

function ListSection({ label, data }: { label: string; data: ListSectionDiff }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={labelCls}>{label}</h3>
        <span className="tabular text-[12px] text-ink-3">
          {data.baselineCount > 0
            ? `${data.baselineCount} → ${data.submittedCount}`
            : `${data.submittedCount} submitted`}
        </span>
      </div>
      {data.submittedItems.length === 0 ? (
        <p className="text-[13px] text-ink-4">None submitted.</p>
      ) : (
        <div className="space-y-1">
          {data.submittedItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-1 text-[14px]">
              <div className="min-w-0">
                <span className="text-ink">{item.name}</span>
                {item.secondary && (
                  <span className="ml-2 text-[12px] text-ink-4">{item.secondary}</span>
                )}
              </div>
              {item.value !== undefined && (
                <span className="tabular shrink-0 text-ink">{formatMoney(item.value)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DocumentsSection ──────────────────────────────────────────────────────────
//
// What the client attached. Filenames link to the EXISTING advisor vault route,
// which is org-scoped by `requireVaultAccess`, audited as
// `vault.document.download`, and serves the bytes as an attachment with
// nosniff. There is deliberately no second download path for intake files.

function DocumentsSection({
  documents,
  householdId,
}: {
  documents: IntakeDocumentView[];
  householdId: string | null;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={labelCls}>Documents</h3>
        <span className="tabular text-[12px] text-ink-3">
          {documents.length} uploaded
        </span>
      </div>
      {documents.length === 0 ? (
        <p className="text-[13px] text-ink-4">No documents uploaded.</p>
      ) : (
        <ul className="space-y-1">
          {documents.map((doc) => {
            const type = intakeDocTypeLabel(doc.docType);
            return (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-4 py-1 text-[14px]"
              >
                <div className="min-w-0">
                  {householdId ? (
                    <a
                      href={`/api/crm/households/${householdId}/documents/${doc.id}`}
                      className="text-ink underline-offset-2 transition-colors hover:text-accent hover:underline"
                    >
                      {doc.filename}
                    </a>
                  ) : (
                    <span className="text-ink">{doc.filename}</span>
                  )}
                  {type && <span className="ml-2 text-[12px] text-ink-4">{type}</span>}
                </div>
                <span className="tabular shrink-0 text-[13px] text-ink-3">
                  {formatBytes(doc.sizeBytes)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── ReviewDetail ──────────────────────────────────────────────────────────────

export interface ReviewDetailProps {
  form: IntakeFormRow;
  diff: IntakeDiff;
  /** Client-uploaded documents. Optional so the one caller is the only place
   *  that has to know how to load them; empty renders the empty state. */
  documents?: IntakeDocumentView[];
  /** The household that owns them — the vault link needs it. Null for a
   *  prospect who never uploaded, which is also when the list is empty. */
  householdId?: string | null;
}

export default function ReviewDetail({
  form,
  diff,
  documents = [],
  householdId = null,
}: ReviewDetailProps) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<"apply" | "discard" | null>(null);

  const alreadyActioned = form.status === "applied" || form.status === "discarded";

  async function handleAction(action: "apply" | "discard") {
    setActionError(null);
    setActing(action);
    try {
      const res = await fetch(`/api/data-collection/${form.id}/${action}`, {
        method: "POST",
      });
      if (res.status === 409) {
        setActionError("This form has already been applied or discarded.");
        return;
      }
      if (res.status === 403) {
        setActionError("You do not have permission to perform this action.");
        return;
      }
      if (!res.ok) {
        setActionError("Something went wrong. Please try again.");
        return;
      }
      // Bust the router cache (incl. the destination's stale entry) before navigating.
      router.refresh();
      if (action === "apply" && form.clientId) {
        router.push(`/clients/${form.clientId}`);
      } else {
        router.push("/data-collection");
      }
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header meta ──────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <h3 className={`${labelCls} mb-3`}>Submission details</h3>
        <div className="space-y-1 text-[14px] text-ink-2">
          <div className="flex items-center justify-between gap-4 py-1">
            <span className="text-ink-3">Recipient</span>
            <span className="text-ink">{form.recipientName ?? form.recipientEmail}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-1">
            <span className="text-ink-3">Email</span>
            <span className="tabular text-ink">{form.recipientEmail}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-1">
            <span className="text-ink-3">Applies to</span>
            {/* clientId, not mode: a blank form can be addressed to an existing
                client, and then applying it merges onto that client's plan. */}
            <span className="text-ink">{form.clientId ? "Existing client" : "New household"}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-1">
            <span className="text-ink-3">Status</span>
            <span className="tabular font-medium text-ink">{form.status}</span>
          </div>
          {form.submittedAt && (
            <div className="flex items-center justify-between gap-4 py-1">
              <span className="text-ink-3">Submitted</span>
              <span className="tabular text-ink">
                {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(form.submittedAt))}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Family diff ─────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <h3 className={`${labelCls} mb-3`}>Family</h3>
        <div className="space-y-1">
          <FieldRow label="Client name" diff={diff.family.primaryName} />
          <FieldRow label="Date of birth" diff={diff.family.primaryDob} />
          <FieldRow label="Marital status" diff={diff.family.primaryMarital} />
          <FieldRow label="Spouse name" diff={diff.family.spouseName} />
          <FieldRow label="Spouse DOB" diff={diff.family.spouseDob} />
          <FieldRow label="State" diff={diff.family.stateOfResidence} />
          <FieldRow label="Children" diff={diff.family.childrenCount as FieldDiff<string | number | undefined>} />
        </div>
      </div>

      {/* ── Goals diff ──────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <h3 className={`${labelCls} mb-3`}>Goals</h3>
        <div className="space-y-1">
          <FieldRow label="Client retirement age" diff={diff.goals.clientRetirementAge as FieldDiff<string | number | undefined>} />
          <FieldRow label="Spouse retirement age" diff={diff.goals.spouseRetirementAge as FieldDiff<string | number | undefined>} />
          <FieldRow
            label="Annual retirement expenses"
            diff={diff.goals.annualRetirementExpenses as FieldDiff<string | number | undefined>}
            format={(v) => formatMoney(v as number | undefined)}
          />
        </div>
      </div>

      {/* ── List sections ───────────────────────────────────────────────── */}
      <ListSection label="Accounts" data={diff.accounts} />
      <ListSection label="Income" data={diff.income} />
      <ListSection label="Property" data={diff.property} />
      <ListSection label="Upcoming goals" data={diff.expenseGoals} />

      {/* ── On your radar ───────────────────────────────────────────────── */}
      {/* Rendered only when the client checked or wrote something: an empty card
          on every other form would train the advisor to scroll past the one that
          isn't empty. Apply files the same content as a CRM note. */}
      {(diff.radar.topics.length > 0 || diff.radar.note) && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <h3 className={`${labelCls} mb-3`}>On your radar</h3>
          {diff.radar.topics.length > 0 && (
            <ul className="space-y-1 text-[14px] text-ink-2">
              {diff.radar.topics.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          )}
          {diff.radar.note && (
            <p className="mt-3 whitespace-pre-wrap border-t border-hair pt-3 text-[14px] text-ink-2">
              {diff.radar.note}
            </p>
          )}
        </div>
      )}

      {/* ── Risk tolerance ──────────────────────────────────────────────── */}
      {/* Only when the client actually answered something. A partial sitting
          still shows: apply writes nothing for it, and the advisor needs to
          know that before they wonder why the score never landed. */}
      {diff.risk.answered > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className={labelCls}>Risk tolerance</h3>
            <span className="tabular text-[12px] text-ink-3">
              {diff.risk.score === null
                ? `Partially answered — no score (${diff.risk.answered}/${diff.risk.total})`
                : `${diff.risk.score} · ${RISK_LEVEL_LABELS[diff.risk.level!]}`}
            </span>
          </div>
          <dl className="space-y-2">
            {diff.risk.answers.map((a) => (
              <div key={a.prompt}>
                <dt className="text-[13px] text-ink-3">{a.prompt}</dt>
                <dd className="text-[14px] text-ink">{a.label}</dd>
              </div>
            ))}
          </dl>
          {diff.risk.note && (
            <p className="mt-3 whitespace-pre-wrap border-t border-hair pt-3 text-[14px] text-ink-2">
              {diff.risk.note}
            </p>
          )}
        </div>
      )}

      {/* ── Documents ───────────────────────────────────────────────────── */}
      <DocumentsSection documents={documents} householdId={householdId} />

      {/* ── Action bar ──────────────────────────────────────────────────── */}
      {!alreadyActioned && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={acting !== null}
            onClick={() => handleAction("apply")}
            className="btn-primary rounded-[var(--radius-sm)] bg-accent px-5 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {acting === "apply" ? "Applying…" : "Apply entire form"}
          </button>
          <button
            type="button"
            disabled={acting !== null}
            onClick={() => handleAction("discard")}
            className="btn-ghost rounded-[var(--radius-sm)] border border-hair px-5 py-2 text-[14px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {acting === "discard" ? "Discarding…" : "Discard"}
          </button>
        </div>
      )}
      {alreadyActioned && (
        <div className="text-[13px] text-ink-3">
          This form has been <span className="font-medium text-ink">{form.status}</span>.
        </div>
      )}
      {actionError && (
        <p role="alert" className="text-[13px] text-red-600">
          {actionError}
        </p>
      )}
    </div>
  );
}
