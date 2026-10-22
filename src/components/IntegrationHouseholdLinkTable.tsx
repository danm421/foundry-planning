"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { useToast } from "@/components/toast";
import type { HouseholdTableRow } from "@/lib/integrations/household-table";
import type { SyncingProviderId } from "@/lib/integrations/types";

interface Household {
  id: string;
  name: string | null;
  linkedClientId: string | null;
  linkedByName: string | null;
}

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

const col = createColumnHelper<Household>();

/** The connection's households as the table shows them: the client it links to,
 *  and who holds it when a colleague already links it through another connection. */
function toHousehold(r: HouseholdTableRow): Household {
  return { id: r.id, name: r.name, linkedClientId: r.link?.clientId ?? null, linkedByName: r.lockedBy };
}

export function IntegrationHouseholdLinkTable({ providerId, connectionId, label }: Props) {
  const base = `/api/integrations/${providerId}/connections/${connectionId}/households`;
  const { showToast } = useToast();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Clients already linked through a colleague's connection, by client id.
  const [takenClients, setTakenClients] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  // Pending client selection per household (before the row is linked).
  const [picks, setPicks] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [hhRes, clientsRes] = await Promise.all([
          fetch(base),
          fetch("/api/clients"),
        ]);
        if (!hhRes.ok || !clientsRes.ok) throw new Error("load failed");
        const hhJson = (await hhRes.json()) as {
          households: HouseholdTableRow[];
          takenClients: Record<string, string>;
        };
        const clientsJson = (await clientsRes.json()) as ClientOption[];
        if (cancelled) return;
        setHouseholds(hhJson.households.map(toHousehold));
        setTakenClients(hhJson.takenClients);
        setClients(clientsJson);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const clientName = useCallback(
    (clientId: string): string => {
      const found = clients.find((c) => c.id === clientId);
      return found ? clientLabel(found) : clientId;
    },
    [clients],
  );

  const link = useCallback(
    async (householdId: string, clientId: string) => {
      // Optimistic: set the link immediately, revert on failure.
      setHouseholds((prev) =>
        prev.map((h) => (h.id === householdId ? { ...h, linkedClientId: clientId } : h)),
      );
      try {
        const res = await fetch(`${base}/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, externalHouseholdId: householdId }),
        });
        if (!res.ok) throw new Error("link failed");
      } catch {
        setHouseholds((prev) =>
          prev.map((h) => (h.id === householdId ? { ...h, linkedClientId: null } : h)),
        );
        showToast({ message: "Couldn't update the link. Please try again." });
      }
    },
    [base, showToast],
  );

  const unlink = useCallback(
    async (householdId: string, clientId: string) => {
      // Optimistic: clear the link (and its attribution) immediately, restore
      // both on failure. `priorLinkedByName` is captured from the mapper
      // itself rather than a closed-over `households` — that keeps this
      // callback's identity stable across household updates.
      let priorLinkedByName: string | null = null;
      setHouseholds((prev) =>
        prev.map((h) => {
          if (h.id !== householdId) return h;
          priorLinkedByName = h.linkedByName;
          return { ...h, linkedClientId: null, linkedByName: null };
        }),
      );
      try {
        const res = await fetch(`${base}/link`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        });
        if (!res.ok) throw new Error("unlink failed");
      } catch {
        setHouseholds((prev) =>
          prev.map((h) =>
            h.id === householdId
              ? { ...h, linkedClientId: clientId, linkedByName: priorLinkedByName }
              : h,
          ),
        );
        showToast({ message: "Couldn't update the link. Please try again." });
      }
    },
    [base, showToast],
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
          if (h.linkedClientId) {
            return (
              <div className="flex items-center gap-3">
                <span className="text-ink">{clientName(h.linkedClientId)}</span>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => unlink(h.id, h.linkedClientId!)}
                >
                  Unlink
                </button>
              </div>
            );
          }
          if (h.linkedByName) {
            return <span className="text-sm text-ink-3">Linked by {h.linkedByName}</span>;
          }
          const picked = picks[h.id] ?? "";
          return (
            <div className="flex items-center gap-3">
              <select
                aria-label="Choose a client to link"
                value={picked}
                onChange={(e) =>
                  setPicks((prev) => ({ ...prev, [h.id]: e.target.value }))
                }
                className="rounded border border-hair bg-paper px-2 py-1 text-sm text-ink"
              >
                <option value="">Select a client…</option>
                {clients
                  .filter((cl) => !takenClients[cl.id])
                  .map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {clientLabel(cl)}
                    </option>
                  ))}
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
      col.accessor("linkedByName", {
        header: "Linked by",
        cell: (c) => (
          <span className="text-sm text-ink-3">{c.getValue() ?? "—"}</span>
        ),
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
  if (loadError) {
    return <p className="text-sm text-ink-3">Couldn&apos;t load households.</p>;
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
    </section>
  );
}
