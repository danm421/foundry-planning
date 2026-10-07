"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IntakeFormRow } from "@/lib/intake/queries";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import type { ClientSearchResult } from "@/lib/client-search";
import { useToast } from "@/components/toast";
import { DocumentsSection } from "./documents-section";
import { ClientPicker } from "./client-picker";
import type { IntakeDiff, FieldDiff, ListSectionDiff } from "./diff-utils";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";

// ── Helpers ───────────────────────────────────────────────────────────────────

const labelCls = "block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";
const linkButtonCls = "text-[12px] font-medium text-accent hover:underline disabled:opacity-50";

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
  /** Whether this form may be pointed at an existing client — the page asks
   *  `canLinkToClient`, the same rule the link itself enforces. */
  canLink?: boolean;
  /** The existing client picked for it (`?linkTo=`). The diff is already
   *  against their plan; Apply links the form to them first. */
  linkTarget?: Pick<ClientSearchResult, "id" | "householdTitle"> | null;
}

export default function ReviewDetail({
  form,
  diff,
  documents = [],
  householdId = null,
  canLink = false,
  linkTarget = null,
}: ReviewDetailProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<"apply" | "discard" | "reopen" | null>(null);
  const [confirmingReopen, setConfirmingReopen] = useState(false);
  const [picking, setPicking] = useState(false);
  // While the page re-renders for a new pick, `linkTarget` still names the old
  // one — Apply waits, or it would apply to the client on screen a moment ago.
  const [switching, startSwitch] = useTransition();

  const alreadyActioned = form.status === "applied" || form.status === "discarded";
  // Only a form waiting on review goes back — the route refuses the rest.
  const canReopen = form.status === "submitted";

  function setLinkTarget(clientId: string | null) {
    setPicking(false);
    startSwitch(() => {
      router.replace(
        clientId ? `/data-collection/${form.id}?linkTo=${clientId}` : `/data-collection/${form.id}`,
        { scroll: false },
      );
    });
  }

  async function handleAction(action: "apply" | "discard") {
    setActionError(null);
    setActing(action);
    try {
      const res = await fetch(`/api/data-collection/${form.id}/${action}`, {
        method: "POST",
        ...(action === "apply" && linkTarget
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId: linkTarget.id }),
            }
          : {}),
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
      const appliedTo = form.clientId ?? linkTarget?.id;
      if (action === "apply" && appliedTo) {
        router.push(`/clients/${appliedTo}`);
      } else {
        router.push("/data-collection");
      }
    } finally {
      setActing(null);
    }
  }

  const who = form.recipientName ?? form.recipientEmail;

  // Stays on this page: the refresh re-renders it as the in-flight view.
  async function handleReopen() {
    setActionError(null);
    setActing("reopen");
    try {
      const res = await fetch(`/api/data-collection/${form.id}/reopen`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; delivered?: boolean };
      if (!res.ok) {
        // The 409s name what to do instead (send a new form, reload) — keep them.
        setActionError(
          res.status === 409 && body.error ? body.error : "Something went wrong. Please try again.",
        );
        return;
      }
      setConfirmingReopen(false);
      showToast({
        message: body.delivered
          ? `Reopened. We emailed ${who} their link.`
          : `Reopened, but no email went out. Use Remind on the Data Collection page to send ${who} their link.`,
      });
      router.refresh();
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
            {canLink ? (
              <span className="flex items-center gap-3">
                <span className="text-ink">{linkTarget?.householdTitle ?? "New household"}</span>
                {linkTarget && (
                  <button
                    type="button"
                    disabled={switching}
                    onClick={() => setLinkTarget(null)}
                    className={linkButtonCls}
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => setPicking((p) => !p)}
                  className={linkButtonCls}
                >
                  {picking ? "Cancel" : linkTarget ? "Change" : "Link to existing client"}
                </button>
              </span>
            ) : (
              /* clientId, not mode: a blank form can be addressed to an existing
                 client, and then applying it merges onto that client's plan. */
              <span className="text-ink">{form.clientId ? "Existing client" : "New household"}</span>
            )}
          </div>
          {picking && (
            <div className="py-2">
              <ClientPicker onPick={(hit) => setLinkTarget(hit.id)} />
            </div>
          )}
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

      {linkTarget && (
        <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 p-4 text-[13px] text-ink-2">
          Applying updates <span className="font-medium text-ink">{linkTarget.householdTitle}</span>
          &apos;s plan instead of creating a new household. Names, birthdays and goals they filled
          in replace what&apos;s there. Accounts, income, property and children are added and
          nothing is removed, so anything you already entered by hand will show up twice.
        </div>
      )}

      {/* ── Family diff ─────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <h3 className={`${labelCls} mb-3`}>Family</h3>
        <div className="space-y-1">
          <FieldRow label="Client name" diff={diff.family.primaryName} />
          <FieldRow label="Date of birth" diff={diff.family.primaryDob} />
          <FieldRow label="Marital status" diff={diff.family.primaryMarital} />
          <FieldRow label="Co-client name" diff={diff.family.spouseName} />
          <FieldRow label="Co-client DOB" diff={diff.family.spouseDob} />
          <FieldRow label="State" diff={diff.family.stateOfResidence} />
          <FieldRow label="Children" diff={diff.family.childrenCount as FieldDiff<string | number | undefined>} />
        </div>
      </div>

      {/* ── Goals diff ──────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <h3 className={`${labelCls} mb-3`}>Goals</h3>
        <div className="space-y-1">
          <FieldRow label="Client retirement age" diff={diff.goals.clientRetirementAge as FieldDiff<string | number | undefined>} />
          <FieldRow label="Co-client retirement age" diff={diff.goals.spouseRetirementAge as FieldDiff<string | number | undefined>} />
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
      {diff.socialSecurity.length > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <h3 className={`${labelCls} mb-3`}>Social Security</h3>
          <div className="space-y-1">
            {diff.socialSecurity.map((row) => (
              <FieldRow key={row.owner} label={row.name} diff={row.answer} />
            ))}
          </div>
        </div>
      )}
      <ListSection label="Property and business interests" data={diff.property} />
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

      {/* ── Estate ──────────────────────────────────────────────────────── */}
      {/* Hidden unless the client answered something, same rule as the radar
          card above. The nominations are the part with no home in the plan —
          apply files them on the CRM note, and this card is where the advisor
          reads them before that happens. */}
      {diff.estate.answered && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <h3 className={`${labelCls} mb-3`}>Estate</h3>
          <div className="space-y-1">
            {diff.estate.principals.map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between gap-4 py-1 text-[14px]"
              >
                <span className="text-ink-3">{p.name}</span>
                <span className="tabular text-ink">{p.detail}</span>
              </div>
            ))}
            {diff.estate.address && (
              <div className="flex items-center justify-between gap-4 py-1 text-[14px]">
                <span className="text-ink-3">Address</span>
                <span className="text-ink">{diff.estate.address}</span>
              </div>
            )}
            {diff.estate.legalResidence && (
              <div className="flex items-center justify-between gap-4 py-1 text-[14px]">
                <span className="text-ink-3">Legal residence</span>
                <span className="text-ink">{diff.estate.legalResidence}</span>
              </div>
            )}
          </div>

          {diff.estate.nominations.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-hair pt-3">
              {diff.estate.nominations.map((n) => (
                <div
                  key={n.role}
                  className="flex items-start justify-between gap-4 py-1 text-[14px]"
                >
                  <span className="text-ink-3">{n.role}</span>
                  <span className="text-right">
                    <span className="text-ink">{n.name}</span>
                    {n.contact && (
                      <span className="ml-2 text-[12px] text-ink-4">{n.contact}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(diff.estate.inheritance || diff.estate.ifPredeceased) && (
            <div className="mt-3 border-t border-hair pt-3">
              <p className="text-[13px] text-ink-3">Who inherits</p>
              {diff.estate.inheritance && (
                <p className="mt-1 text-[14px] text-ink">{diff.estate.inheritance}</p>
              )}
              {diff.estate.ifPredeceased && (
                <p className="mt-1 text-[13px] text-ink-3">
                  If one dies first: {diff.estate.ifPredeceased}
                </p>
              )}
            </div>
          )}

          {diff.estate.distribution && (
            <div className="mt-3 border-t border-hair pt-3">
              <p className="text-[13px] text-ink-3">How the children receive assets</p>
              <p className="mt-1 text-[14px] text-ink">{diff.estate.distribution}</p>
              {diff.estate.distributionNote && (
                <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink-2">
                  {diff.estate.distributionNote}
                </p>
              )}
            </div>
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
            disabled={acting !== null || switching}
            onClick={() => handleAction("apply")}
            className="btn-primary rounded-[var(--radius-sm)] bg-accent px-5 py-2 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {acting === "apply"
              ? "Applying…"
              : linkTarget
                ? `Apply to ${linkTarget.householdTitle}`
                : "Apply entire form"}
          </button>
          <button
            type="button"
            disabled={acting !== null || switching}
            onClick={() => handleAction("discard")}
            className="btn-ghost rounded-[var(--radius-sm)] border border-hair px-5 py-2 text-[14px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {acting === "discard" ? "Discarding…" : "Discard"}
          </button>
          {canReopen && (
            <button
              type="button"
              disabled={acting !== null || switching}
              aria-expanded={confirmingReopen}
              onClick={() => setConfirmingReopen((c) => !c)}
              className="ml-auto text-[13px] font-medium text-ink-2 transition-colors hover:text-accent disabled:opacity-50"
            >
              Reopen for changes
            </button>
          )}
        </div>
      )}
      {canReopen && confirmingReopen && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-4">
          <p className="text-[14px] text-ink-2">
            Send this form back to <span className="font-medium text-ink">{who}</span>? We&apos;ll
            email them their link. Everything they entered stays, so they only add what&apos;s new.
            It comes back here when they submit again.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={acting !== null}
              onClick={handleReopen}
              className="btn-primary rounded-[var(--radius-sm)] bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {acting === "reopen" ? "Reopening…" : "Reopen and email"}
            </button>
            <button
              type="button"
              disabled={acting !== null}
              onClick={() => setConfirmingReopen(false)}
              className="text-[13px] text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
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
