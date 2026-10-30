"use client";

import { useId, useState, type ReactElement } from "react";
import { useDismissableMenu } from "@/lib/use-dismissable-menu";
import { MAX_ACCOUNTS_PER_ADVISOR } from "@/lib/workspace/accounts";
import type { AccountSummary } from "@/lib/workspace/types";
import { GOOGLE_CONNECT_URL, MICROSOFT_CONNECT_URL, reconnectUrl } from "./calendar-pane-state";

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const ITEM =
  "block w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-card-2 hover:text-ink";
const PANEL =
  "absolute left-0 top-full z-30 mt-1.5 rounded-[var(--radius-sm)] border border-hair bg-paper p-1";
const SMALL_BUTTON =
  "shrink-0 rounded-[var(--radius-sm)] border border-hair-2 px-2 py-0.5 text-[12px] text-ink-2 hover:border-ink-4 hover:text-ink " +
  FOCUS;

/**
 * The connected addresses above the week. One address keeps the plain
 * "Connected as … · Disconnect" line; two or more become a row of chips, each
 * with its own menu. Either way `+ Add account` opens the connect panel.
 *
 * Below md a panel anchored under its trigger can run off a phone screen, so
 * every panel here hangs from this bar's left edge instead (the bar is
 * `relative`, the triggers' wrappers only `md:relative`). From md up the to-do
 * column to the right leaves room for it under the trigger.
 */
export function AccountBar({
  accounts,
  labels,
  hidden,
  onToggleHidden,
  onDisconnect,
  googleEnabled,
  itApprovalUrl,
  googleClientId,
}: {
  accounts: AccountSummary[];
  /** Short names by connection id; null with fewer than two accounts. */
  labels: ReadonlyMap<string, string> | null;
  hidden: ReadonlySet<string>;
  onToggleHidden: (connectionId: string) => void;
  /** Asks the page to confirm and disconnect this account. */
  onDisconnect: (account: AccountSummary) => void;
  googleEnabled: boolean;
  /** Where a Microsoft organization's admin approves Foundry; null when Microsoft isn't set up. */
  itApprovalUrl: string | null;
  googleClientId: string | null;
}): ReactElement {
  const sole = accounts.length === 1 ? accounts[0] : null;
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {sole ? (
        <p className="text-[12px] text-ink-3">
          Connected as <span className="text-ink-2">{sole.email}</span> ·{" "}
          <button
            type="button"
            onClick={() => onDisconnect(sole)}
            className={`underline underline-offset-2 hover:text-ink ${FOCUS}`}
          >
            Disconnect
          </button>
        </p>
      ) : (
        accounts.map((a) => (
          <AccountChip
            key={a.id}
            account={a}
            label={labels?.get(a.id) ?? a.email}
            isHidden={hidden.has(a.id)}
            onToggleHidden={() => onToggleHidden(a.id)}
            onDisconnect={() => onDisconnect(a)}
          />
        ))
      )}
      <AddAccountPanel
        atCap={accounts.length >= MAX_ACCOUNTS_PER_ADVISOR}
        googleEnabled={googleEnabled}
        itApprovalUrl={itApprovalUrl}
        googleClientId={googleClientId}
      />
    </div>
  );
}

function AccountChip({
  account,
  label,
  isHidden,
  onToggleHidden,
  onDisconnect,
}: {
  account: AccountSummary;
  label: string;
  isHidden: boolean;
  onToggleHidden: () => void;
  onDisconnect: () => void;
}): ReactElement {
  const { open, setOpen, ref } = useDismissableMenu<HTMLDivElement>();
  return (
    <div ref={ref} className="md:relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={account.email}
        onClick={() => setOpen((v) => !v)}
        className={`chip chip-sentence cursor-pointer hover:border-ink-4 ${FOCUS} ${isHidden ? "line-through opacity-60" : ""}`}
      >
        {account.status === "needs_reconnect" ? (
          <span aria-hidden className="size-1.5 rounded-full bg-warn" />
        ) : null}
        {label}
        {/* The strike-through says it to the eye; this says it aloud. */}
        {isHidden ? <span className="sr-only"> (hidden)</span> : null}
        {account.status === "needs_reconnect" ? <span className="sr-only"> (needs to reconnect)</span> : null}
      </button>
      {open ? (
        <div role="menu" className={`${PANEL} min-w-[140px]`}>
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              setOpen(false);
              onToggleHidden();
            }}
          >
            {isHidden ? "Show" : "Hide"}
          </button>
          {account.status === "needs_reconnect" ? (
            <a role="menuitem" href={reconnectUrl(account)} className={ITEM}>
              Reconnect
            </a>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AddAccountPanel({
  atCap,
  googleEnabled,
  itApprovalUrl,
  googleClientId,
}: {
  atCap: boolean;
  googleEnabled: boolean;
  itApprovalUrl: string | null;
  googleClientId: string | null;
}): ReactElement {
  const { open, setOpen, ref } = useDismissableMenu<HTMLDivElement>();
  const panelId = useId();
  // A disclosure, not a menu: the panel holds help text and Copy buttons a
  // screen reader's menu mode would skip. Its connect entries are plain links
  // (the routes answer with a redirect to the provider).
  const item = (label: string, href: string) =>
    atCap ? (
      <span key={label} aria-disabled="true" className={`${ITEM} cursor-not-allowed opacity-50 hover:bg-transparent hover:text-ink-2`}>
        {label}
      </span>
    ) : (
      <a key={label} href={href} className={ITEM}>
        {label}
      </a>
    );
  // At most the bar's width below md (see AccountBar).
  return (
    <div ref={ref} className="md:relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center rounded-full border border-hair-2 px-2.5 text-[12px] text-ink-2 hover:border-ink-4 hover:text-ink ${FOCUS}`}
      >
        + Add account
      </button>
      {open ? (
        <div id={panelId} className={`${PANEL} w-[min(340px,100%)] md:w-[340px]`}>
          {googleEnabled ? item("Google", GOOGLE_CONNECT_URL) : null}
          {item("Microsoft 365", MICROSOFT_CONNECT_URL)}
          {atCap ? (
            <p className="px-3 py-1.5 text-[12px] text-ink-3">
              5 addresses connected — the most Workspace allows.
            </p>
          ) : null}
          {itApprovalUrl ? (
            <div className="mt-1 border-t border-hair px-3 py-2 text-[12px] text-ink-3">
              <p>Microsoft says your organization must approve Foundry? Send this link to your IT admin.</p>
              <CopyButton text={itApprovalUrl} label="Copy link" />
            </div>
          ) : null}
          {googleEnabled && googleClientId ? (
            <div className="mt-1 border-t border-hair px-3 py-2 text-[12px] text-ink-3">
              <p>
                Google says your administrator blocks Foundry? Ask them to allow &quot;Foundry Planning&quot; in the
                Google Admin console (Security → API controls). They&apos;ll need this client ID:
              </p>
              <p className="tabular mt-1 break-all text-ink-2">{googleClientId}</p>
              <CopyButton text={googleClientId} label="Copy" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Copies, then says so for a moment. A blocked clipboard leaves the label as it was. */
function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  }
  return (
    <button type="button" onClick={copy} className={`${SMALL_BUTTON} mt-1.5`}>
      {copied ? "Copied" : label}
    </button>
  );
}
