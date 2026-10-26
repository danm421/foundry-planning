"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import DialogShell from "@/components/dialog-shell";
import { defaultConnectionName } from "@/lib/integrations/providers/addepar/credentials";
import type { ProviderAuthKind, SyncingProviderId } from "@/lib/integrations/types";

type ConnectionStatus = "connected" | "disconnected" | "error";

interface Props {
  providerId: SyncingProviderId;
  connectionId: string;
  /** The connection's name (the provider label when it was never named). */
  name: string;
  label: string;
  authKind: ProviderAuthKind;
  status: ConnectionStatus;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** Addepar only: the saved (non-secret) address and firm ID, to prefill a reconnect. */
  apiBase?: string;
  addeparFirmId?: string;
}

/** Refresh / sync arrows — minimal outline, inherits text color. */
function SyncIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function StatusPip({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-good"
      : status === "error"
        ? "bg-warn"
        : "bg-ink-4";
  const label =
    status === "connected"
      ? "Connected"
      : status === "error"
        ? "Reconnect needed"
        : "Not connected";
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function IntegrationConnectionCard({
  providerId,
  connectionId,
  name,
  label,
  authKind,
  status,
  lastSyncedAt,
  lastSyncError,
  apiBase,
  addeparFirmId,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<"sync" | "disconnect" | "delete" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const base = `/api/integrations/${providerId}/connections/${connectionId}`;

  async function handleSync() {
    setBusy("sync");
    try {
      const res = await fetch(`${base}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("sync failed");
      const { committed, queued } = (await res.json()) as {
        committed: number;
        queued: number;
      };
      showToast({ message: `Synced — ${committed} updated, ${queued} queued for review` });
      router.refresh();
    } catch {
      showToast({ message: "Sync failed. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      const res = await fetch(`${base}/disconnect`, { method: "POST" });
      if (!res.ok) throw new Error("disconnect failed");
      router.refresh();
    } catch {
      showToast({ message: "Couldn't disconnect. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      router.push(`/settings/integrations/${providerId}`);
      router.refresh();
    } catch {
      showToast({ message: "Couldn't delete this connection. Please try again." });
      setBusy(null);
    }
  }

  // A connection that can't sync can still be removed.
  const deleteButton = (
    <div>
      <button
        type="button"
        className="btn-ghost text-sm"
        onClick={() => setConfirmingDelete(true)}
        disabled={busy !== null}
      >
        Delete
      </button>
      <DialogShell
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${name}?`}
        size="sm"
        destructiveAction={{ label: "Delete", onClick: handleDelete, loading: busy === "delete" }}
      >
        <p className="text-[14px] text-ink-2">
          This removes the connection and unlinks the households linked through it. Connect again
          later by adding it as a new connection.
        </p>
      </DialogShell>
    </div>
  );

  const reconnect = { connectionId, name, apiBase, addeparFirmId };

  return (
    <section className="flex flex-col gap-4 rounded border border-hair bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <StatusPip status={status} />
        {status === "connected" && lastSyncedAt ? (
          <span className="text-xs text-ink-3">
            Last synced <span className="tabular">{formatSyncedAt(lastSyncedAt)}</span>
          </span>
        ) : null}
      </div>

      {status === "disconnected" || status === "error" ? (
        <>
          <p className="text-sm text-ink-3">
            {status === "error"
              ? `Foundry can no longer reach ${label}. Reconnect to resume syncing.${lastSyncError ? ` (${lastSyncError})` : ""}`
              : `This connection is turned off. Reconnect to resume syncing, or delete it.`}
          </p>
          {authKind === "byok" ? (
            <ByokConnectForm providerId={providerId} label={label} reconnect={reconnect} />
          ) : (
            <div>
              <a className="btn-primary" href={`/api/integrations/${providerId}/connect`}>
                Reconnect {label}
              </a>
            </div>
          )}
          {deleteButton}
        </>
      ) : null}

      {status === "connected" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={handleSync}
            disabled={busy !== null}
          >
            <SyncIcon />
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <FieldTooltip text={`Pulls accounts and holdings from linked ${label} households. Existing accounts update in place; new ones are queued for your review before they touch a plan.`} />
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={handleDisconnect}
            disabled={busy !== null}
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

type CredsPostOutcome = { ok: true; connectionId?: string } | { ok: false; error?: string };

/** Shared POST for the BYOK `test`, `connect` and reconnect routes — all take
 * the credential JSON body and report `{ ok, error? }` (connect adds `connectionId`). */
async function postAddeparCreds(url: string, body: Record<string, unknown>): Promise<CredsPostOutcome> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { error?: string; connectionId?: string } | null;
    return res.ok ? { ok: true, connectionId: data?.connectionId } : { ok: false, error: data?.error };
  } catch {
    return { ok: false };
  }
}

function CredentialField({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  tooltip,
  hint,
}: {
  id: string;
  label: string;
  type?: "text" | "url" | "password";
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  tooltip?: string;
  /** Where to find the value — shown under the input. */
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className={`${fieldLabelClassName} mb-0`} htmlFor={id}>
          {label}
        </label>
        {tooltip ? <FieldTooltip text={tooltip} /> : null}
      </div>
      <input
        id={id}
        className={inputClassName}
        type={type}
        autoComplete={type === "password" ? "off" : undefined}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
        required
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Credential form for BYOK providers (Addepar): a name, API base, Addepar firm
 * ID, API key/secret, an attestation checkbox, and a "Test connection" step
 * that must pass before "Connect" is enabled. Any credential edit clears
 * the last test result so a stale pass can't authorize new credentials.
 * Without `reconnect` it adds a new connection and opens its page; with it,
 * it re-keys that connection in place so its household links carry on.
 */
export function ByokConnectForm({
  providerId,
  label,
  reconnect,
}: {
  providerId: SyncingProviderId;
  label: string;
  reconnect?: { connectionId: string; name: string; apiBase?: string; addeparFirmId?: string };
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [apiBase, setApiBase] = useState(reconnect?.apiBase ?? "");
  const [addeparFirmId, setAddeparFirmId] = useState(reconnect?.addeparFirmId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  // Until the advisor types a name, it follows the address (https://ethos.addepar.com
  // suggests "Ethos"); a reconnect starts from the connection's current name.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [testResult, setTestResult] = useState<"pass" | "fail" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const name =
    typedName ?? (reconnect ? reconnect.name : apiBase.trim() ? defaultConnectionName(apiBase) : "");

  // A credential field changed — the last "Test connection" result no
  // longer speaks to the credentials currently in the form.
  function onCredentialChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
      setTestResult(null);
      setTestError(null);
    };
  }

  async function handleTest() {
    setBusy("test");
    setTestError(null);
    const creds = { apiBase, addeparFirmId, apiKey, apiSecret };
    const result = await postAddeparCreds(`/api/integrations/${providerId}/test`, creds);
    if (result.ok) setTestResult("pass");
    else {
      setTestResult("fail");
      setTestError(result.error ?? "Couldn't reach Addepar with those credentials.");
    }
    setBusy(null);
  }

  async function handleConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("connect");
    const creds = { apiBase, addeparFirmId, apiKey, apiSecret, attestation: true, name: name.trim() };
    const url = reconnect
      ? `/api/integrations/${providerId}/connections/${reconnect.connectionId}/credentials`
      : `/api/integrations/${providerId}/connect`;
    const result = await postAddeparCreds(url, creds);
    if (result.ok) {
      showToast({ message: `${label} ${reconnect ? "reconnected" : "connected"}.` });
      if (!reconnect && result.connectionId) {
        router.push(`/settings/integrations/${providerId}/${result.connectionId}`);
      }
      router.refresh();
    } else {
      showToast({ message: result.error ?? `Couldn't connect ${label}. Please try again.` });
    }
    setBusy(null);
  }

  const credentialsIncomplete =
    !apiBase.trim() || !addeparFirmId.trim() || !apiKey.trim() || !apiSecret.trim();
  const canConnect = attested && testResult === "pass" && !!name.trim() && busy === null;

  return (
    <form className="flex flex-col gap-3" onSubmit={handleConnect}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={fieldLabelClassName} htmlFor={`${providerId}-name`}>
            Name
          </label>
          <input
            id={`${providerId}-name`}
            className={inputClassName}
            value={name}
            onChange={(e) => setTypedName(e.target.value)}
            maxLength={60}
            required
          />
        </div>
        <CredentialField
          id={`${providerId}-api-base`}
          label="API base URL"
          type="url"
          value={apiBase}
          onChange={onCredentialChange(setApiBase)}
          placeholder="https://yourfirm.addepar.com"
        />
        <CredentialField
          id={`${providerId}-firm-id`}
          label="Addepar firm ID"
          value={addeparFirmId}
          onChange={onCredentialChange(setAddeparFirmId)}
          hint={
            <>
              In Addepar&rsquo;s Analysis tool, choose Export &rarr; Generate API URL. It&rsquo;s the
              number after <span className="font-mono">addepar_firm=</span>
            </>
          }
        />
        <CredentialField
          id={`${providerId}-api-key`}
          label="API key"
          type="password"
          value={apiKey}
          onChange={onCredentialChange(setApiKey)}
          tooltip="Create them in Addepar under Firm Administration → Firm Settings → API Access Key. Foundry stores them encrypted for this firm only."
        />
        <CredentialField
          id={`${providerId}-api-secret`}
          label="API secret"
          type="password"
          value={apiSecret}
          onChange={onCredentialChange(setApiSecret)}
        />
      </div>

      <label htmlFor={`${providerId}-attestation`} className="flex items-start gap-2 text-sm text-ink-2">
        <input
          id={`${providerId}-attestation`}
          type="checkbox"
          className="mt-0.5"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
        />
        I confirm these are my firm&rsquo;s Addepar API credentials and I&rsquo;m authorized to connect them.
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleTest}
          disabled={credentialsIncomplete || busy !== null}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        {testResult === "pass" ? (
          <span className="text-sm text-good">✓ Connection verified</span>
        ) : null}
        {testResult === "pass" && !attested ? (
          <span className="text-sm text-ink-3">Tick the confirmation box to connect.</span>
        ) : null}
        {testResult === "fail" ? (
          <span className="text-sm text-crit">✗ {testError}</span>
        ) : null}
        <button
          type="submit"
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canConnect}
        >
          {busy === "connect" ? "Connecting…" : reconnect ? "Reconnect" : "Connect"}
        </button>
      </div>
    </form>
  );
}
