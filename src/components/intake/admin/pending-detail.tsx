import type { IntakeFormRow } from "@/lib/intake/queries";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import {
  INTAKE_SECTION_LABELS,
  renderableSections,
  type IntakeSectionKey,
} from "@/lib/intake/sections";
import { pruneIntakeBlankRows } from "@/lib/intake/schema";
import { isExpired } from "@/lib/intake/tokens";
import { DocumentsSection } from "./documents-section";
import { STATUS_META } from "./status-meta";

const labelCls = "block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function when(d: Date | null | undefined): string {
  return d ? DATE_TIME.format(new Date(d)) : "—";
}

/**
 * True when a section object holds anything the client actually typed. Used for
 * the sections that are not lists — the list rows are already pruned by
 * `pruneIntakeBlankRows` before they get here.
 */
function hasAnswer(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.some(hasAnswer);
  if (typeof v === "object") return Object.values(v).some(hasAnswer);
  return false;
}

/**
 * How far the client has got in one section, read from the draft payload the
 * wizard autosaves. Deliberately coarse: the only question this page answers is
 * whether chasing them is worth it.
 */
function progress(
  section: IntakeSectionKey,
  payload: Record<string, unknown>,
  documentCount: number,
): string {
  // Uploads are rows in their own table, never in the payload.
  if (section === "documents") {
    return documentCount > 0 ? `${documentCount} uploaded` : "Nothing yet";
  }
  const value = payload[section];
  // The SHAPE decides the wording, not a hardcoded list of which sections are
  // arrays — that list already exists twice elsewhere, and a fourth list
  // section would have to be added to a third copy here.
  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length} added` : "Nothing yet";
  }
  return hasAnswer(value) ? "Started" : "Nothing yet";
}

export interface PendingDetailProps {
  form: IntakeFormRow;
  /** The set the form collects, already resolved through `sectionsForForm`. */
  sections: IntakeSectionKey[];
  documents: IntakeDocumentView[];
  householdId: string | null;
}

/**
 * The advisor's view of a form that is still out with the client — or one that
 * was cancelled before it came back.
 *
 * Separate from `ReviewDetail` rather than a mode of it, because the two
 * answer different questions. Review diffs a submitted payload against the plan
 * and offers Apply/Discard; there is nothing here to apply, and a payload this
 * page rendered through the submit schema would fail to parse (a half-filled
 * draft legitimately breaks every strict rule) — which is exactly how this page
 * used to 404.
 */
export default function PendingDetail({
  form,
  sections,
  documents,
  householdId,
}: PendingDetailProps) {
  // Unvalidated on purpose: a draft payload is mid-typing and cannot satisfy
  // the submit schema. Nothing below reads a value out of it — only whether one
  // is there.
  //
  // Pruned first, with the SAME function submit uses, so "1 added" means what
  // the wizard and the apply path both mean by it: the client autosaves the
  // moment they click Add, and counting those empty cards would tell the
  // advisor work is done that isn't.
  const payload = pruneIntakeBlankRows(form.payload ?? {}) as Record<string, unknown>;

  // The portal wizard has no upload step, so a pre-filled form never asks for
  // documents however the stored set reads. Same rule the wizard itself applies.
  const asked =
    form.mode === "prefilled" ? renderableSections(sections, false) : sections;

  // `isExpired`, not `status === "expired"`: almost nothing writes that status
  // (only the revoke endpoint), while a draft that simply ran past `expiresAt`
  // is the common dead form — its link opens onto nothing and Remind can only
  // 409. Both, plus a draft the advisor discarded, are "over".
  const now = new Date();
  const over = isExpired(form, now);
  const lapsed = new Date(form.expiresAt).getTime() <= now.getTime();
  // The same word and pip the queue row carried — an advisor who clicked
  // "Awaiting reply" must not land on a page that calls it something else.
  const status = STATUS_META[form.status];
  const anyAnswers = asked.some((s) => progress(s, payload, documents.length) !== "Nothing yet");

  return (
    <div className="space-y-6">
      {/* ── Status ───────────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 className={labelCls}>Form details</h3>
          <span className={`flex items-center gap-1.5 text-[12px] ${status.text}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.pip}`} />
            {status.label}
          </span>
        </div>
        <div className="space-y-1 text-[14px]">
          <Row label="Recipient" value={form.recipientName ?? form.recipientEmail} />
          <Row label="Email" value={form.recipientEmail} mono />
          {/* clientId, not mode: a blank form can be addressed to an existing
              client, and then applying it merges onto that client's plan. */}
          <Row label="Applies to" value={form.clientId ? "Existing client" : "New household"} />
          <Row
            label="Sent as"
            value={form.mode === "prefilled" ? "Portal request" : "Email link"}
          />
          <Row label="Sent" value={when(form.sentAt ?? form.createdAt)} mono />
          <Row label="Opened" value={when(form.openedAt)} mono />
          <Row label={lapsed ? "Expired" : "Expires"} value={when(form.expiresAt)} mono />
        </div>
      </div>

      {/* ── Progress ─────────────────────────────────────────────────────── */}
      {/* Named: "Documents" is both a step here and the heading of the upload
          list below, so a test reading one has to be able to say which. */}
      <div
        data-testid="asked-for"
        className="rounded-[var(--radius-sm)] border border-hair bg-card p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 className={labelCls}>What we asked for</h3>
          <span className="tabular text-[12px] text-ink-3">{asked.length} steps</span>
        </div>
        <div className="space-y-1">
          {asked.map((section) => {
            const state = progress(section, payload, documents.length);
            const started = state !== "Nothing yet";
            return (
              <div
                key={section}
                className="flex items-center justify-between gap-4 py-1 text-[14px]"
              >
                <span className={started ? "text-ink" : "text-ink-3"}>
                  {INTAKE_SECTION_LABELS[section]}
                </span>
                <span className={`tabular text-[13px] ${started ? "text-ink-2" : "text-ink-4"}`}>
                  {state}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 border-t border-hair pt-3 text-[13px] text-ink-3">
          {over
            ? "This form can't be filled in any more, and nothing on it reaches the plan. Send a new one to collect these answers."
            : anyAnswers
              ? "Answers save as they type. Nothing reaches the plan until they submit and you review it."
              : "They haven't started yet. Remind them from the Data Collection queue."}
        </p>
      </div>

      {/* Uploads happen while the form is still out, so the list is worth
          showing whenever there is one — even on a form that asked for
          nothing else. */}
      {(asked.includes("documents") || documents.length > 0) && (
        <DocumentsSection documents={documents} householdId={householdId} />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-ink-3">{label}</span>
      <span className={`${mono ? "tabular " : ""}text-ink`}>{value}</span>
    </div>
  );
}
