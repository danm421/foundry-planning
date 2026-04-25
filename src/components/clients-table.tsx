"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AddClientDialog from "./add-client-dialog";
import TypedConfirmDeleteDialog from "./typed-confirm-delete-dialog";
import { ClientFormInitial } from "./forms/add-client-form";

interface ClientRow {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  lifeExpectancy?: number;
  filingStatus: string;
  spouseName?: string | null;
  spouseLastName?: string | null;
  spouseDob?: string | null;
  spouseRetirementAge?: number | null;
  spouseLifeExpectancy?: number | null;
  email?: string | null;
  address?: string | null;
  spouseEmail?: string | null;
  spouseAddress?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date;
}

type ViewMode = "recent" | "all";

const RECENT_LIMIT = 10;

interface ClientsTableProps {
  rows: ClientRow[];
}

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married Filing Jointly",
  married_separate: "Married Filing Separately",
  head_of_household: "Head of Household",
};

function toInitial(c: ClientRow): ClientFormInitial {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: typeof c.dateOfBirth === "string" ? c.dateOfBirth : new Date(c.dateOfBirth).toISOString(),
    retirementAge: c.retirementAge,
    lifeExpectancy: c.lifeExpectancy ?? 95,
    filingStatus: c.filingStatus,
    spouseName: c.spouseName ?? null,
    spouseLastName: c.spouseLastName ?? null,
    spouseDob: c.spouseDob ? (typeof c.spouseDob === "string" ? c.spouseDob : new Date(c.spouseDob).toISOString()) : null,
    spouseRetirementAge: c.spouseRetirementAge ?? null,
    spouseLifeExpectancy: c.spouseLifeExpectancy ?? null,
    email: c.email ?? null,
    address: c.address ?? null,
    spouseEmail: c.spouseEmail ?? null,
    spouseAddress: c.spouseAddress ?? null,
  };
}

export default function ClientsTable({ rows }: ClientsTableProps) {
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [deleting, setDeleting] = useState<ClientRow | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("recent");

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = rows.filter((c) => {
      if (!query) return true;
      const primary = `${c.firstName} ${c.lastName}`.toLowerCase();
      const spouse = c.spouseName
        ? `${c.spouseName} ${c.spouseLastName ?? ""}`.toLowerCase()
        : "";
      return primary.includes(query) || spouse.includes(query);
    });
    if (view === "recent") {
      return [...matches]
        .sort((a, b) => {
          const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return tb - ta;
        })
        .slice(0, RECENT_LIMIT);
    }
    return [...matches].sort((a, b) => {
      const byLast = a.lastName.localeCompare(b.lastName);
      return byLast !== 0 ? byLast : a.firstName.localeCompare(b.firstName);
    });
  }, [rows, search, view]);

  async function performDelete(client: ClientRow) {
    const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete client");
      return;
    }
    setDeleting(null);
    setEditing(null);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Clients</h1>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`rounded-md border px-4 py-2 text-sm font-medium ${
                editMode
                  ? "border-blue-600 bg-blue-900/40 text-blue-300"
                  : "border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700"
              }`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
          )}
          <AddClientDialog />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or spouse"
            className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-md"
          />
          <div className="flex items-center gap-4 text-sm text-gray-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="clients-view"
                value="recent"
                checked={view === "recent"}
                onChange={() => setView("recent")}
                className="h-4 w-4 accent-blue-500"
              />
              Recent
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="clients-view"
                value="all"
                checked={view === "all"}
                onChange={() => setView("all")}
                className="h-4 w-4 accent-blue-500"
              />
              All Clients
            </label>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-sm">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-400">No clients yet. Click &quot;Add Client&quot; to get started.</p>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-400">No clients match &quot;{search}&quot;.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Filing Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Date Added</th>
                {editMode && <th className="px-6 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900">
              {visibleRows.map((client) => {
                const onClickName = (e: React.MouseEvent) => {
                  if (editMode) {
                    e.preventDefault();
                    setEditing(client);
                  }
                };
                const spouseLabel = client.spouseName
                  ? `${client.spouseName}${client.spouseLastName ? ` ${client.spouseLastName}` : ""}`
                  : null;
                return (
                  <tr key={client.id} className="hover:bg-gray-800">
                    <td className="whitespace-nowrap px-6 py-4">
                      {editMode ? (
                        <button
                          type="button"
                          onClick={() => setEditing(client)}
                          className="font-medium text-blue-500 hover:text-blue-400"
                        >
                          {client.firstName} {client.lastName}
                          {spouseLabel && <span className="text-gray-400"> &amp; {spouseLabel}</span>}
                        </button>
                      ) : (
                        <Link
                          href={`/clients/${client.id}/client-data/balance-sheet`}
                          onClick={onClickName}
                          className="font-medium text-blue-500 hover:text-blue-400"
                        >
                          {client.firstName} {client.lastName}
                          {spouseLabel && <span className="text-gray-400"> &amp; {spouseLabel}</span>}
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                      {FILING_LABELS[client.filingStatus] ?? client.filingStatus}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                      {new Date(client.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    {editMode && (
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <button
                          onClick={() => setDeleting(client)}
                          className="text-gray-500 hover:text-red-400"
                          aria-label={`Delete ${client.firstName} ${client.lastName}`}
                          title="Delete client"
                        >
                          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit dialog (controlled) */}
      <AddClientDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        editing={editing ? toInitial(editing) : undefined}
        onRequestDelete={() => {
          if (editing) setDeleting(editing);
        }}
      />

      {/* Typed-name confirm for client delete */}
      <TypedConfirmDeleteDialog
        open={!!deleting}
        title="Delete Client"
        message={
          deleting
            ? `This will permanently delete ${deleting.firstName} ${deleting.lastName} and all associated data (accounts, liabilities, incomes, expenses, savings rules, withdrawal strategies, and plan settings). This cannot be undone.`
            : ""
        }
        confirmText={deleting ? `${deleting.firstName} ${deleting.lastName}` : ""}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await performDelete(deleting);
        }}
      />
    </div>
  );
}
