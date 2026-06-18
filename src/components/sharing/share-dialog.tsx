"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import type { ClientShareRow } from "@/db/schema";

// ---------------------------------------------------------------------------
// Inline SVG icon components (avoid external icon dependency)
// ---------------------------------------------------------------------------

function IconShare() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconUnlock() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Permission = "view" | "edit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initialIsPrivate: boolean;
}

// ---------------------------------------------------------------------------
// ShareDialog
// ---------------------------------------------------------------------------

export default function ShareDialog({ open, onOpenChange, clientId, initialIsPrivate }: Props) {
  // Body scroll lock — ref-counted, safe for stacked dialogs.
  useBodyScrollLock(open);

  // --- Share form state ---
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<Permission>("view");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // --- Existing shares state ---
  const [shares, setShares] = useState<ClientShareRow[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // --- Privacy toggle state ---
  const [isPrivate, setIsPrivate] = useState(initialIsPrivate);
  const [privacySaving, setPrivacySaving] = useState(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Sync isPrivate when prop changes (e.g. parent re-renders after revoke/share).
  // Skip while a save is in flight to avoid clobbering the optimistic toggle.
  useEffect(() => {
    if (!privacySaving) setIsPrivate(initialIsPrivate);
  }, [initialIsPrivate, privacySaving]);

  // Fetch this client's existing shares from the outgoing list.
  const fetchShares = useCallback(() => {
    if (!open) return;
    setSharesLoading(true);
    fetch(`/api/shares?direction=outgoing`, { method: "GET" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { shares: ClientShareRow[] }) => {
        // Filter to shares for this specific client (scope:"client")
        const clientShares = data.shares.filter(
          (s) => s.clientId === clientId && s.scope === "client",
        );
        setShares(clientShares);
      })
      .catch(() => setShares([]))
      .finally(() => setSharesLoading(false));
  }, [open, clientId]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Focus the surface when it opens
  useEffect(() => {
    if (open) surfaceRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // --- Handlers ---

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), permission }),
      });
      if (res.status === 409) {
        setSubmitError("This person already has access to this client.");
        return;
      }
      if (res.status === 404) {
        setSubmitError("No Foundry user found with that email address.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError((data as { error?: string }).error ?? "Failed to share client.");
        return;
      }
      setEmail("");
      setPermission("view");
      setSubmitSuccess(true);
      fetchShares();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(shareId: string) {
    setRevoking(shareId);
    setRevokeError(null);
    try {
      const res = await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRevokeError((data as { error?: string }).error ?? "Failed to revoke access.");
      }
    } catch {
      setRevokeError("Failed to revoke access.");
    } finally {
      setRevoking(null);
      fetchShares();
    }
  }

  async function handlePrivacyToggle() {
    const next = !isPrivate;
    setIsPrivate(next);
    setPrivacySaving(true);
    try {
      await fetch(`/api/clients/${clientId}/privacy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: next }),
      });
    } catch {
      // Revert on failure
      setIsPrivate(!next);
    } finally {
      setPrivacySaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        data-testid="dialog-overlay"
        className="absolute inset-0 bg-paper/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Surface */}
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label="Share client"
        tabIndex={-1}
        style={{ maxHeight: "min(80vh, 720px)" }}
        className="relative z-10 w-full max-w-[540px] flex flex-col whitespace-normal rounded-[var(--radius)] bg-card border-2 border-ink-3 ring-1 ring-black/60 shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-4 border-b border-hair">
          <div className="flex items-center gap-2 text-ink-3">
            <IconShare />
            <h2 className="text-[16px] font-semibold text-ink">Share Client</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-card-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-5 pb-6 space-y-6">

          {/* ── Privacy toggle ── */}
          <div className="flex items-center justify-between rounded-lg border border-hair bg-card-2 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className={isPrivate ? "text-warn" : "text-ink-3"}>
                {isPrivate ? <IconLock /> : <IconUnlock />}
              </span>
              <div>
                <p className="text-[13px] font-medium text-ink leading-none mb-0.5">
                  Private client
                </p>
                <p className="text-[12px] text-ink-3 leading-snug">
                  {isPrivate
                    ? "Only you and org admins can see this client."
                    : "Visible to your firm members."}
                </p>
              </div>
            </div>
            <label className="sr-only" htmlFor="private-toggle">
              Private client
            </label>
            <button
              id="private-toggle"
              role="checkbox"
              aria-checked={isPrivate}
              aria-label="Private"
              type="button"
              onClick={handlePrivacyToggle}
              disabled={privacySaving}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                isPrivate ? "bg-accent" : "bg-hair-2"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-ink shadow-sm transition-transform ${
                  isPrivate ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* ── Add share form ── */}
          <form id="share-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="share-email"
                className="block text-[13px] font-medium text-ink-2 mb-1.5"
              >
                Email
              </label>
              <input
                id="share-email"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setSubmitError(null);
                  setSubmitSuccess(false);
                }}
                placeholder="advisor@otherfirm.com"
                className="w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-medium text-ink-2">Permission</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="permission"
                    value="view"
                    checked={permission === "view"}
                    onChange={() => setPermission("view")}
                    className="accent-accent"
                  />
                  <span className="text-[13px] text-ink">View</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="permission"
                    value="edit"
                    checked={permission === "edit"}
                    onChange={() => setPermission("edit")}
                    className="accent-accent"
                  />
                  <span className="text-[13px] text-ink">Edit</span>
                </label>
              </div>
            </div>

            {submitError && (
              <p role="alert" className="text-[12px] text-crit">
                {submitError}
              </p>
            )}
            {submitSuccess && (
              <p role="status" className="text-[12px] text-good flex items-center gap-1.5">
                <IconCheck />
                Invite sent.
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary h-9 px-5 text-[13px] font-medium disabled:opacity-50"
            >
              {submitting ? "Sharing…" : "Share"}
            </button>
          </form>

          {/* ── Existing shares ── */}
          {revokeError && (
            <p role="alert" className="text-[12px] text-crit">
              {revokeError}
            </p>
          )}

          {sharesLoading && (
            <p className="text-[12px] text-ink-4">Loading shared access…</p>
          )}

          {!sharesLoading && shares.length > 0 && (
            <div className="space-y-1">
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3 mb-2">
                Shared with
              </p>
              <ul className="space-y-1">
                {shares.map((share) => (
                  <li
                    key={share.id}
                    className="flex items-center justify-between rounded-md border border-hair bg-card-2 px-3 py-2"
                  >
                    <div>
                      <p className="text-[13px] text-ink">{share.recipientEmail}</p>
                      <p className="text-[11px] text-ink-3 uppercase tracking-[0.06em]">
                        {share.permission}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(share.id)}
                      disabled={revoking === share.id}
                      aria-label={`Revoke access for ${share.recipientEmail}`}
                      className="flex h-7 w-7 items-center justify-center rounded text-ink-4 hover:text-crit hover:bg-card disabled:opacity-40"
                    >
                      <IconTrash />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!sharesLoading && shares.length === 0 && (
            <p className="text-[12px] text-ink-4">
              This client isn&apos;t shared with anyone yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
