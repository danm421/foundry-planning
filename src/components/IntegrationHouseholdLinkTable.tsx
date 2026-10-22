"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { useToast } from "@/components/toast";
import { IntegrationAccountsPanel } from "@/components/IntegrationAccountsPanel";
import type { HouseholdTableRow } from "@/lib/integrations/household-table";
import type { SyncingProviderId } from "@/lib/integrations/types";

interface ClientOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

interface Props {
  providerId: SyncingProviderId;
  connectionId: string;
  label: string;
}

function clientLabel(c: ClientOption): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.id;
}

const col = createColumnHelper<HouseholdTableRow>();

export function IntegrationHouseholdLinkTable({ providerId, connectionId, label }: Props) {
  const base = `/api/integrations/${providerId}/connections/${connectionId}/households`;
  const { showToast } = useToast();
  const [households, setHouseholds] = useState<HouseholdTableRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Clients already linked through a colleague's connection, by client id.
  const [takenClients, setTakenClients] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<"reconnect" | "failed" | null>(null);
  // Pending client selection per household (before the row is linked).
  const [picks, setPicks] = useState<Record<string, string>>({});
  // The link whose accounts panel is open.
  const [panelLinkId, setPanelLinkId] = useState<string | null>(null);

  /** Reads the table from the server, in the server's order. */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [hhRes, clientsRes] = await Promise.all([fetch(base), fetch("/api/clients")]);
      if (hhRes.status === 409) {
        const j = (await hhRes.json().catch(() => null)) as { error?: string } | null;
        setLoadError(j?.error === "reconnect_required" ? "reconnect" : "failed");
        return false;
      }
      if (!hhRes.ok || !clientsRes.ok) throw new Error("load failed");
      const hhJson = (await hhRes.json()) as {
        households: HouseholdTableRow[];
        takenClients: Record<string, string>;
      };
      const clientsJson = (await clientsRes.json()) as ClientOption[];
      setHouseholds(hhJson.households);
      setTakenClients(hhJson.takenClients);
      setClients(clientsJson);
      setLoadError(null);
      return true;
    } catch {
      setLoadError("failed");
      return false;
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const clientName = useCallback(
    (clientId: string): string => {
      const found = clients.find((c) => c.id === clientId);
      return found ? clientLabel(found) : clientId;
    },
    [clients],
  );

  const link = useCallback(
    async (householdId: string, clientId: string) => {
      try {
        const res = await fetch(`${base}/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, externalHouseholdId: householdId }),
        });
        if (res.ok) {
          setPicks((prev) => ({ ...prev, [householdId]: "" }));
          await load();
          return;
        }
        if (res.status === 409) {
          const j = (await res.json().catch(() => null)) as { linkedByName?: string | null } | null;
          showToast({ message: `That client is already linked by ${j?.linkedByName ?? "another advisor"}.` });
          return;
        }
        throw new Error("link failed");
      } catch {
        showToast({ message: "Couldn't update the link. Please try again." });
      }
    },
    [base, load, showToast],
  );

  const unlink = useCallback(
    async (clientId: string) => {
      try {
        const res = await fetch(`${base}/link`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        });
        if (!res.ok) throw new Error("unlink failed");
        await load();
      } catch {
        showToast({ message: "Couldn't update the link. Please try again." });
      }
    },
    [base, load, showToast],
  );

  const columns = useMemo(
    () => [
      col.accessor("name", {
        header: "Household",
        cell: (c) => {
          const h = c.row.original;
          return h.name ? (
            <span className="text-ink">{h.name}</span>
          ) : (
            <span className="tabular text-xs text-ink-3">{h.id}</span>
          );
        },
      }),
      col.display({
        id: "linkedClient",
        header: "Linked client",
        cell: (c) => {
          const h = c.row.original;
          if (h.link) {
            const clientId = h.link.clientId;
            return (
              <div className="flex items-center gap-3">
                <span className="text-ink">{clientName(clientId)}</span>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => unlink(clientId)}>
                  Unlink
                </button>
              </div>
            );
          }
          if (h.lockedBy) {
            return <span className="text-sm text-ink-3">Linked by {h.lockedBy}</span>;
          }
          const picked = picks[h.id] ?? "";
          return (
            <div className="flex items-center gap-3">
              <select
                aria-label="Choose a client to link"
                value={picked}
                onChange={(e) => setPicks((prev) => ({ ...prev, [h.id]: e.target.value }))}
                className="rounded border border-hair bg-paper px-2 py-1 text-sm text-ink"
              >
                <option value="">Select a client…</option>
                {clients.map((cl) => {
                  const taker = takenClients[cl.id];
                  return (
                    <option key={cl.id} value={cl.id} disabled={!!taker}>
                      {taker ? `${clientLabel(cl)} · linked by ${taker}` : clientLabel(cl)}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                className="btn-primary px-2 py-1 text-xs"
                disabled={!picked}
                onClick={() => link(h.id, picked)}
              >
                Link
              </button>
            </div>
          );
        },
      }),
      col.display({
        id: "accounts",
        header: "Accounts",
        cell: (c) => {
          const h = c.row.original;
          if (!h.link) return null;
          if (!h.accounts) return <span className="text-sm text-ink-3">Not synced yet</span>;
          const linkId = h.link.linkId;
          return (
            <button
              type="button"
              className="btn-ghost tabular px-2 py-1 text-xs"
              aria-label={`Manage ${h.accounts.total} accounts for ${h.name ?? h.id}`}
              onClick={() => setPanelLinkId(linkId)}
            >
              {h.accounts.connected} of {h.accounts.total}
            </button>
          );
        },
      }),
    ],
    [clients, takenClients, picks, clientName, link, unlink],
  );

  const table = useReactTable({
    data: households,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (loading) {
    return <p className="text-sm text-ink-3">Loading…</p>;
  }
  if (loadError === "reconnect") {
    return <p className="text-sm text-ink-3">Reconnect {label} above to see its households.</p>;
  }
  if (loadError) {
    return <p className="text-sm text-ink-3">Couldn&apos;t load households</p>;
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-ink">Household links</h3>
      <p className="text-sm text-ink-3">
        Link each {label} household to a Foundry client so sync knows where its accounts land.
      </p>
      <div className="overflow-hidden rounded border border-hair">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wide text-ink-3">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 font-medium">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-hair">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {households.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-ink-3">
                  No households found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {panelLinkId && (
        <IntegrationAccountsPanel
          providerId={providerId}
          connectionId={connectionId}
          linkId={panelLinkId}
          open
          onClose={() => {
            setPanelLinkId(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
