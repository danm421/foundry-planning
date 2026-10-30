"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { inputClassName } from "@/components/forms/input-styles";
import type { WorkspaceProvider } from "@/lib/workspace/types";

type Account = {
  connectionId: string;
  provider: WorkspaceProvider;
  email: string;
  status: "connected" | "needs_reconnect";
};

type Member = { userId: string; displayName: string; accounts: Account[] };

type Flash = "approved" | "consent_declined" | "consent_expired" | null;

type Props = {
  members: Member[];
  approval: { approvedAt: string } | null;
  flash: Flash;
};

/** What the confirm dialog is about to remove. */
type Confirm = { kind: "everyone" } | { kind: "address"; account: Account; owner: string };

const ADMIN_BASE = "/api/workspace/admin";
const CONSENT_START = "/api/workspace/microsoft/admin-consent/start";
/** This card's page, without the flash's `?approved=1` / `?error=consent_*`. */
const PAGE_PATH = "/settings/integrations/microsoft_365";
const LINK_COPIED = "Link copied — it works once and expires in 7 days.";

const FLASH_COPY: Record<Exclude<Flash, null>, string> = {
  approved: "Microsoft 365 is approved for your organization.",
  consent_declined: "Microsoft 365 wasn't approved. You can try again any time.",
  consent_expired: "That approval link expired or was already used. Start again to get a new one.",
};

const PROVIDER_LABEL: Record<WorkspaceProvider, string> = { google: "Google", microsoft: "Microsoft 365" };

const STATUS: Record<Account["status"], { label: string; pip: string }> = {
  connected: { label: "Connected", pip: "bg-good" },
  needs_reconnect: { label: "Needs to reconnect", pip: "bg-warn" },
};

const DISCONNECT_EVERYONE =
  "Every advisor's Google and Microsoft addresses leave Workspace. To fully remove Foundry on Microsoft's side, also remove \"Foundry Planning\" from Microsoft Entra → Enterprise applications.";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** A new single-use admin-consent URL; throws when the route refuses. */
async function consentUrl(mode: "redirect" | "link"): Promise<string> {
  const res = await post(CONSENT_START, { mode });
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

/**
 * The firm admin's Workspace page: who has connected which addresses (with a
 * Disconnect per address), the optional Microsoft organization approval, and
 * Disconnect everyone. Advisors connect their own addresses from Workspace.
 */
export function WorkspaceAdminCard({ members, approval, flash }: Props): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "approve" | "link" | "disconnect">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A link the clipboard refused: shown so the admin can copy it by hand.
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // Read once, then cleared from the URL so a reload or bookmark can't replay
  // it; the banner stays until the admin leaves the page. "Approved" never
  // shows once the approval is gone (after Disconnect everyone).
  const [flashOnLoad] = useState(flash);
  const shownFlash = flashOnLoad === "approved" && approval === null ? null : flashOnLoad;
  useEffect(() => {
    if (flashOnLoad) router.replace(PAGE_PATH);
  }, [flashOnLoad, router]);

  const anythingConnected = approval !== null || members.some((m) => m.accounts.length > 0);

  async function approve() {
    setBusy("approve");
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

  async function disconnect(c: Confirm) {
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    const url =
      c.kind === "everyone"
        ? `${ADMIN_BASE}/disconnect-all`
        : `${ADMIN_BASE}/connections/${encodeURIComponent(c.account.connectionId)}/disconnect`;
    try {
      const res = await post(url);
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError(
        c.kind === "everyone"
          ? "Couldn't disconnect everyone. Try again."
          : `Couldn't disconnect ${c.account.email}. Try again.`,
      );
    } finally {
      setConfirm(null);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {shownFlash ? (
        <p role="status" className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2">
          {FLASH_COPY[shownFlash]}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-crit">
          {error}
        </p>
      ) : null}

      <section className="rounded border border-hair bg-card">
        <h2 className="border-b border-hair px-4 py-3 text-sm font-medium text-ink">Connected addresses</h2>
        <ul className="divide-y divide-hair">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
              <span className="text-sm text-ink sm:w-48 sm:shrink-0 sm:py-1">{m.displayName}</span>
              {m.accounts.length === 0 ? (
                <span className="text-sm text-ink-3 sm:py-1">No addresses connected</span>
              ) : (
                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {m.accounts.map((a) => (
                    <li key={a.connectionId} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="w-28 shrink-0 text-ink-3">{PROVIDER_LABEL[a.provider]}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{a.email}</span>
                      <span className="inline-flex items-center gap-2 text-ink-2">
                        <span className={`h-2 w-2 rounded-full ${STATUS[a.status].pip}`} aria-hidden="true" />
                        {STATUS[a.status].label}
                      </span>
                      <button
                        type="button"
                        className="btn-ghost text-sm"
                        aria-label={`Disconnect ${a.email}`}
                        onClick={() => setConfirm({ kind: "address", account: a, owner: m.displayName })}
                        disabled={busy === "disconnect"}
                      >
                        Disconnect
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded border border-hair bg-card p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-ink">Microsoft organization approval (optional)</h2>
          <p className="text-sm text-ink-3">
            Only needed if your Microsoft organization stops people approving apps themselves.
          </p>
        </div>
        {approval ? (
          <p className="inline-flex items-center gap-2 text-sm text-ink-2">
            <span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />
            Approved · <span className="tabular">{formatDate(approval.approvedAt)}</span>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost text-sm" onClick={approve} disabled={busy !== null}>
                Approve Microsoft 365
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={copyLink} disabled={busy !== null}>
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
          </>
        )}
      </section>

      {anythingConnected ? (
        <div>
          <button type="button" className="btn-ghost text-sm" onClick={() => setConfirm({ kind: "everyone" })}>
            Disconnect everyone
          </button>
        </div>
      ) : null}

      <DialogShell
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.kind === "address" ? `Disconnect ${confirm.account.email}?` : "Disconnect everyone?"}
        size="sm"
        destructiveAction={{
          label: "Disconnect",
          onClick: () => {
            if (confirm) void disconnect(confirm);
          },
          loading: busy === "disconnect",
        }}
      >
        <p className="text-[14px] text-ink-2">
          {confirm?.kind === "address"
            ? `Its calendar and to-dos leave ${confirm.owner}'s Workspace. They can connect it again any time.`
            : DISCONNECT_EVERYONE}
        </p>
      </DialogShell>
    </div>
  );
}
