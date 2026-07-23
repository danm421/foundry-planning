"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import type { ProviderId, ProviderAuthKind } from "@/lib/integrations/types";

type ConnectionStatus = "connected" | "disconnected" | "error";

interface Props {
  providerId: ProviderId;
  label: string;
  enabled: boolean;
  authKind: ProviderAuthKind;
  status: ConnectionStatus;
  /** ISO string (serialized across the server boundary) or null. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
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
  label,
  enabled,
  authKind,
  status,
  lastSyncedAt,
  lastSyncError,
}: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);

  if (!enabled) {
    return (
      <div className="rounded-lg border border-hair p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">{label}</h2>
          <span className="rounded-full bg-card-2 px-2 py-0.5 text-xs text-ink-3">
            Available soon
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          We&rsquo;re working with {label} to enable direct account syncing.
        </p>
      </div>
    );
  }

  async function handleSync() {
    setBusy("sync");
    try {
      const res = await fetch(`/api/integrations/${providerId}/sync`, {
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
      const res = await fetch(`/api/integrations/${providerId}/disconnect`, { method: "POST" });
      if (!res.ok) throw new Error("disconnect failed");
      router.refresh();
    } catch {
      showToast({ message: "Couldn't disconnect. Please try again." });
    } finally {
      setBusy(null);
    }
  }

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

      {status === "disconnected" ? (
        <>
          <p className="text-sm text-ink-3">
            Connect your {label} account to sync household accounts and holdings into Foundry.
          </p>
          {authKind === "byok" ? (
            <ByokConnectForm providerId={providerId} label={label} />
          ) : (
            <div>
              <a className="btn-primary" href={`/api/integrations/${providerId}/connect`}>
                Connect {label}
              </a>
            </div>
          )}
        </>
      ) : null}

      {status === "error" ? (
        <>
          <p className="text-sm text-ink-3">
            Foundry can no longer reach {label}. Reconnect to resume syncing.
            {lastSyncError ? ` (${lastSyncError})` : ""}
          </p>
          {authKind === "byok" ? (
            <ByokConnectForm providerId={providerId} label={label} />
          ) : (
            <div>
              <a className="btn-primary" href={`/api/integrations/${providerId}/connect`}>
                Reconnect {label}
              </a>
            </div>
          )}
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

type CredsPostOutcome = { ok: true } | { ok: false; error?: string };

/** Shared POST for the BYOK `test` and `connect` routes — both accept the
 * same credential JSON body and report `{ ok, error? }`. */
async function postAddeparCreds(url: string, body: Record<string, unknown>): Promise<CredsPostOutcome> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return res.ok ? { ok: true } : { ok: false, error: data?.error };
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
}: {
  id: string;
  label: string;
  type?: "text" | "url" | "password";
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  tooltip?: string;
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
        required
      />
    </div>
  );
}

/**
 * Credential form for BYOK providers (Addepar): API base, Addepar firm ID,
 * API key/secret, an attestation checkbox, and a "Test connection" step
 * that must pass before "Connect" is enabled. Any credential edit clears
 * the last test result so a stale pass can't authorize new credentials.
 */
function ByokConnectForm({ providerId, label }: { providerId: ProviderId; label: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [apiBase, setApiBase] = useState("https://api.addepar.com");
  const [addeparFirmId, setAddeparFirmId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [testResult, setTestResult] = useState<"pass" | "fail" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

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
    const creds = { apiBase, addeparFirmId, apiKey, apiSecret, attestation: true };
    const result = await postAddeparCreds(`/api/integrations/${providerId}/connect`, creds);
    if (result.ok) {
      showToast({ message: `${label} connected.` });
      router.refresh();
    } else {
      showToast({ message: result.error ?? `Couldn't connect ${label}. Please try again.` });
    }
    setBusy(null);
  }

  const credentialsIncomplete = !apiBase || !addeparFirmId || !apiKey || !apiSecret;
  const canConnect = attested && testResult === "pass" && busy === null;

  return (
    <form className="flex flex-col gap-3" onSubmit={handleConnect}>
      <div className="grid gap-3 sm:grid-cols-2">
        <CredentialField
          id={`${providerId}-api-base`}
          label="API base URL"
          type="url"
          value={apiBase}
          onChange={onCredentialChange(setApiBase)}
          placeholder="https://api.addepar.com"
        />
        <CredentialField
          id={`${providerId}-firm-id`}
          label="Addepar firm ID"
          value={addeparFirmId}
          onChange={onCredentialChange(setAddeparFirmId)}
        />
        <CredentialField
          id={`${providerId}-api-key`}
          label="API key"
          type="password"
          value={apiKey}
          onChange={onCredentialChange(setApiKey)}
          tooltip="Generate an API key and secret in Addepar's admin console under API credentials. Foundry stores them encrypted for this firm only."
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
          className="btn-ghost text-sm"
          onClick={handleTest}
          disabled={credentialsIncomplete || busy !== null}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        {testResult === "pass" ? (
          <span className="text-sm text-good">✓ Connection verified</span>
        ) : null}
        {testResult === "fail" ? (
          <span className="text-sm text-crit">✗ {testError}</span>
        ) : null}
        <button type="submit" className="btn-primary text-sm" disabled={!canConnect}>
          {busy === "connect" ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}
