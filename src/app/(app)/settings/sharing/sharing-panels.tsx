"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ShareDialog from "@/components/sharing/share-dialog";
import type { OutgoingShare, IncomingShare, ShareableClient } from "./sharing-content";

type Props = {
  outgoing: OutgoingShare[];
  incoming: IncomingShare[];
  shareableClients: ShareableClient[];
};

function permissionLabel(p: "view" | "edit"): string {
  return p === "edit" ? "View & Edit" : "View only";
}

// ---------------------------------------------------------------------------
// Share-all panel: add / list / revoke share-all grants
// ---------------------------------------------------------------------------
function ShareAllPanel({
  shares,
}: {
  shares: OutgoingShare[];
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OutgoingShare[]>(shares);
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), permission }),
      });
      if (res.ok) {
        const data = (await res.json()) as { share: OutgoingShare };
        setRows((prev) => [...prev, data.share]);
        setEmail("");
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Something went wrong.");
      }
    });
  };

  const handleRevoke = (shareId: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== shareId));
      }
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-sm font-medium text-ink">Share all my clients</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Grant another Foundry advisor read or edit access to your entire book. They must already have a Foundry account.
        </p>
      </header>

      {/* Add form */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="advisor@example.com"
            className="h-8 flex-1 min-w-48 rounded border border-hair bg-card-2 px-3 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && email.trim()) handleAdd();
            }}
          />
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value as "view" | "edit")}
            className="h-8 rounded border border-hair bg-card-2 px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="view">View only</option>
            <option value="edit">View &amp; Edit</option>
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!email.trim() || isPending}
            className="btn-primary h-8 px-4 text-sm disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && (
          <p className="text-xs text-crit" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Recipients table */}
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded border border-hair">
          <table className="w-full text-sm">
            <caption className="sr-only">Share-all recipients</caption>
            <thead className="bg-paper">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Recipient
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Permission
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-ink-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-hair">
                  <td className="px-3 py-2 text-ink">{r.recipientEmail}</td>
                  <td className="px-3 py-2 text-ink-3">{permissionLabel(r.permission)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRevoke(r.id)}
                      disabled={isPending}
                      className="text-xs text-ink-4 underline hover:text-crit disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-4">No active share-all recipients.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Individually shared panel: pick a client, open ShareDialog to create the
// share, and list / revoke shares already granted.
// ---------------------------------------------------------------------------
function IndividualSharesPanel({
  shares,
  shareableClients,
}: {
  shares: OutgoingShare[];
  shareableClients: ShareableClient[];
}): React.ReactElement {
  const router = useRouter();
  const [rows, setRows] = useState<OutgoingShare[]>(shares);
  const [isPending, startTransition] = useTransition();
  const [selectedClientId, setSelectedClientId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Shares are created inside ShareDialog; a router.refresh() re-renders the
  // server component with fresh rows — resync local state to the new props.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- server-driven prop resync after router.refresh(); shares only changes on a fresh server render, no render-time cascade.
  useEffect(() => setRows(shares), [shares]);

  const selected = shareableClients.find((c) => c.id === selectedClientId) ?? null;

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) startTransition(() => router.refresh());
  };

  const handleRevoke = (shareId: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== shareId));
      }
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-sm font-medium text-ink">Individually shared clients</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Grant another advisor access to a single client, or revoke a share you granted.
        </p>
      </header>

      {/* Share-a-client picker */}
      <div className="flex flex-wrap gap-2">
        <label htmlFor="share-client-picker" className="sr-only">
          Client to share
        </label>
        <select
          id="share-client-picker"
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="h-8 flex-1 min-w-48 rounded border border-hair bg-card-2 px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">Select a client…</option>
          {shareableClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={!selected || isPending}
          className="btn-primary h-8 px-4 text-sm disabled:opacity-50"
        >
          Share…
        </button>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded border border-hair">
          <table className="w-full text-sm">
            <caption className="sr-only">Individually shared clients</caption>
            <thead className="bg-paper">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Client
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Recipient
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Permission
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-ink-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-hair">
                  <td className="px-3 py-2 text-ink">{r.clientName ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-3">{r.recipientEmail}</td>
                  <td className="px-3 py-2 text-ink-3">{permissionLabel(r.permission)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRevoke(r.id)}
                      disabled={isPending}
                      className="text-xs text-ink-4 underline hover:text-crit disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-4">No individually shared clients.</p>
      )}

      {selected ? (
        <ShareDialog
          open={dialogOpen}
          onOpenChange={handleDialogChange}
          clientId={selected.id}
          initialIsPrivate={selected.isPrivate}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared with me panel: read-only incoming shares
// ---------------------------------------------------------------------------
function SharedWithMePanel({
  shares,
}: {
  shares: IncomingShare[];
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-sm font-medium text-ink">Shared with me</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Clients from other advisors that have been shared with your account.
        </p>
      </header>

      {shares.length > 0 ? (
        <div className="overflow-hidden rounded border border-hair">
          <table className="w-full text-sm">
            <caption className="sr-only">Clients shared with me</caption>
            <thead className="bg-paper">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Advisor
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Firm
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-ink-4">
                  Permission
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-ink-4 tabular">
                  Clients
                </th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr key={`${s.ownerUserId}|${s.firmId}`} className="border-t border-hair">
                  <td className="px-3 py-2 text-ink">{s.ownerName}</td>
                  <td className="px-3 py-2 text-ink-3">{s.firmName}</td>
                  <td className="px-3 py-2 text-ink-3">{permissionLabel(s.permission)}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-3">{s.clientCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-4">No clients have been shared with you.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------
export function SharingPanels({ outgoing, incoming, shareableClients }: Props): React.ReactElement {
  const shareAll = outgoing.filter((r) => r.scope === "all");
  const perClient = outgoing.filter((r) => r.scope === "client");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-base font-medium text-ink">Sharing</h1>

      <div className="rounded border border-hair bg-card p-[var(--pad-card)]">
        <ShareAllPanel shares={shareAll} />
      </div>

      <div className="rounded border border-hair bg-card p-[var(--pad-card)]">
        <IndividualSharesPanel shares={perClient} shareableClients={shareableClients} />
      </div>

      <div className="rounded border border-hair bg-card p-[var(--pad-card)]">
        <SharedWithMePanel shares={incoming} />
      </div>
    </div>
  );
}
