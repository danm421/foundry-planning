"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { inputClassName } from "@/components/forms/input-styles";
import { SwitchControl } from "@/components/forms/switch-control";
import type { MemberStatus } from "@/lib/workspace/types";

type Member = {
  userId: string;
  displayName: string;
  status: MemberStatus;
  connectedEmail: string | null;
  enabled: boolean;
};

type Flash = "approved" | "consent_declined" | "consent_expired" | null;

type Props = {
  approval: { approvedAt: string } | null;
  members: Member[];
  flash: Flash;
};

const BASE = "/api/workspace/microsoft";
/** This card's page, without the flash's `?approved=1` / `?error=consent_*`. */
const PAGE_PATH = "/settings/integrations/microsoft_365";
const LINK_COPIED = "Link copied — it works once and expires in 7 days.";
const ALL_ON = "Microsoft 365 is on for everyone. Each advisor connects their own Outlook from Workspace.";

const FLASH_COPY: Record<Exclude<Flash, null>, string> = {
  approved: "Microsoft 365 is approved. Now choose which advisors get it.",
  consent_declined: "Microsoft 365 wasn't approved. You can try again any time.",
  consent_expired: "That approval link expired or was already used. Start again to get a new one.",
};

const STATUS: Record<MemberStatus, { label: string; pip: string | null; text: string }> = {
  connected: { label: "Connected", pip: "bg-good", text: "text-ink-2" },
  not_connected: { label: "Hasn't connected yet", pip: "bg-ink-4", text: "text-ink-2" },
  off: { label: "Off", pip: null, text: "text-ink-4" },
  needs_reconnect: { label: "Needs to reconnect", pip: "bg-warn", text: "text-ink-2" },
};

const STEPS = [
  "You sign in with a Microsoft 365 global admin account.",
  "Microsoft asks you to approve Foundry for your firm.",
  "You choose which advisors get it.",
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** A new single-use admin-consent URL; throws when the route refuses. */
async function consentUrl(mode: "redirect" | "link"): Promise<string> {
  const res = await post("admin-consent/start", { mode });
  if (!res.ok) throw new Error();
  return ((await res.json()) as { url: string }).url;
}

/**
 * Copies `text` once it resolves. Safari only allows a clipboard write that
 * starts inside the click, so this must be called before any `await`; a
 * `ClipboardItem` can wait on the text. Rejects when the copy didn't happen.
 */
async function copyWhenReady(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
  }
  return navigator.clipboard.writeText(await text);
}

function without(s: Record<string, boolean>, key: string): Record<string, boolean> {
  const rest = { ...s };
  delete rest[key];
  return rest;
}

export function MicrosoftWorkspaceAdminCard({ approval, members, flash }: Props): ReactElement {
  const router = useRouter();
  // A switch shows its new value from the click until the refreshed props agree
  // with it (dropped by the effect below, or at once if the request fails).
  // `saving` is the rows whose request is still out: one request per row.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<null | "connect" | "link" | "all" | "disconnect">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A link the clipboard refused: shown so the admin can copy it by hand.
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Read once, then cleared from the URL so a reload or bookmark can't replay
  // it; the banner stays until the admin leaves the page. "Approved" never
  // shows once the approval is gone (after Disconnect).
  const [flashOnLoad] = useState(flash);
  const shownFlash = flashOnLoad === "approved" && approval === null ? null : flashOnLoad;
  useEffect(() => {
    if (flashOnLoad) router.replace(PAGE_PATH);
  }, [flashOnLoad, router]);

  useEffect(() => {
    setPending((s) => {
      const caughtUp = members.filter((m) => m.userId in s && s[m.userId] === m.enabled);
      if (caughtUp.length === 0) return s;
      const rest = { ...s };
      for (const m of caughtUp) delete rest[m.userId];
      return rest;
    });
  }, [members]);

  async function connect() {
    setBusy("connect");
    setError(null);
    setNotice(null);
    try {
      const url = await consentUrl("redirect");
      window.location.assign(url);
    } catch {
      setError("Couldn't start the Microsoft approval. Try again.");
      setBusy(null);
    }
  }

  async function copyLink() {
    setBusy("link");
    setError(null);
    setNotice(null);
    setLinkToCopy(null);
    const link = consentUrl("link");
    // Started before any await, inside the click (see copyWhenReady).
    const copied = copyWhenReady(link).then(
      () => true,
      () => false,
    );
    try {
      const url = await link;
      if (await copied) setNotice(LINK_COPIED);
      else setLinkToCopy(url);
    } catch {
      setError("Couldn't create the approval link. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(m: Member, next: boolean) {
    setError(null);
    setNotice(null);
    setPending((s) => ({ ...s, [m.userId]: next }));
    setSaving((s) => ({ ...s, [m.userId]: true }));
    try {
      const res = await post(`members/${encodeURIComponent(m.userId)}/access`, { enabled: next });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setPending((s) => without(s, m.userId));
      setError(`Couldn't change access for ${m.displayName}. Try again.`);
    } finally {
      setSaving((s) => without(s, m.userId));
    }
  }

  async function turnOnAll() {
    setBusy("all");
    setError(null);
    setNotice(null);
    try {
      const res = await post("members/access-all");
      if (!res.ok) throw new Error();
      // The only change on screen may be one switch, so say it worked.
      setNotice(ALL_ON);
      router.refresh();
    } catch {
      setError("Couldn't turn Microsoft 365 on for everyone. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    try {
      const res = await post("disconnect");
      if (!res.ok) throw new Error();
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setConfirmOpen(false);
      setError("Couldn't disconnect Microsoft 365. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {shownFlash ? (
        <p
          role="status"
          className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2"
        >
          {FLASH_COPY[shownFlash]}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-crit">
          {error}
        </p>
      ) : null}

      {approval ? (
        <>
          <p className="inline-flex items-center gap-2 text-sm text-ink-2">
            <span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />
            Approved · <span className="tabular">{formatDate(approval.approvedAt)}</span>
          </p>

          <section className="rounded border border-hair bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
              <h2 className="text-sm font-medium text-ink">Advisors</h2>
              <button
                type="button"
                className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-50"
                onClick={turnOnAll}
                disabled={busy === "all" || members.every((m) => pending[m.userId] ?? m.enabled)}
              >
                Turn on for everyone
              </button>
            </div>
            {notice ? (
              <p role="status" className="border-b border-hair px-4 py-2 text-sm text-ink-3">
                {notice}
              </p>
            ) : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hair text-left font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-4 py-2 font-normal">Foundry user</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 text-right font-normal">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {members.map((m) => {
                  const on = pending[m.userId] ?? m.enabled;
                  // Mid-flip, show where the row is heading: off is Off, and a
                  // freshly switched-on row has not connected yet.
                  const shown: MemberStatus =
                    m.userId in pending ? (on ? (m.enabled ? m.status : "not_connected") : "off") : m.status;
                  const st = STATUS[shown];
                  const email = on ? m.connectedEmail : null;
                  return (
                    <tr key={m.userId}>
                      <td className="px-4 py-3 text-ink">{m.displayName}</td>
                      <td className={`px-4 py-3 ${st.text}`}>
                        <span className="inline-flex items-center gap-2">
                          {st.pip ? (
                            <span className={`h-2 w-2 rounded-full ${st.pip}`} aria-hidden="true" />
                          ) : null}
                          {st.label}
                        </span>
                        {email ? <div className="text-xs text-ink-3">{email}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <SwitchControl
                          checked={on}
                          onChange={(next) => toggle(m, next)}
                          disabled={saving[m.userId] === true}
                          ariaLabel={`Microsoft 365 access for ${m.displayName}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div>
            <button type="button" className="btn-ghost text-sm" onClick={() => setConfirmOpen(true)}>
              Disconnect Microsoft 365
            </button>
          </div>

          <DialogShell
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Disconnect Microsoft 365?"
            size="sm"
            destructiveAction={{ label: "Disconnect", onClick: disconnect, loading: busy === "disconnect" }}
          >
            <p className="text-[14px] text-ink-2">
              Every advisor is signed out of Microsoft 365 and their calendar and to-dos leave
              Workspace. To fully revoke, also remove Foundry Planning in Microsoft Entra →
              Enterprise applications.
            </p>
          </DialogShell>
        </>
      ) : (
        <section className="flex flex-col gap-4 rounded border border-hair bg-card p-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-ink">What happens when you connect</h2>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-2">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={connect}
              disabled={busy !== null}
            >
              Connect Microsoft 365
            </button>
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={copyLink}
              disabled={busy !== null}
            >
              Copy approval link
            </button>
          </div>
          {notice ? (
            <p role="status" className="text-sm text-ink-3">
              {notice}
            </p>
          ) : null}
          {linkToCopy ? (
            <div className="flex flex-col gap-2">
              <p role="status" className="text-sm text-ink-3">
                Copy this link by hand — it works once and expires in 7 days.
              </p>
              <input
                readOnly
                aria-label="Approval link"
                value={linkToCopy}
                onFocus={(e) => e.currentTarget.select()}
                className={inputClassName}
              />
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
