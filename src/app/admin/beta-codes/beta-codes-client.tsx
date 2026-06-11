"use client";

import { useState, useTransition } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { mintCodesAction, revokeCodeAction } from "./actions";

export type CodeRow = {
  id: string;
  label: string | null;
  entitlements: string[];
  status: "unused" | "redeemed" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  redeemedByUserId: string | null;
  redeemedOrgId: string | null;
};

const STATUS_STYLE: Record<CodeRow["status"], string> = {
  unused: "bg-emerald-500/15 text-emerald-300",
  redeemed: "bg-sky-500/15 text-sky-300",
  expired: "bg-amber-500/15 text-amber-300",
  revoked: "bg-red-500/15 text-red-300",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BetaCodesClient({ initialCodes }: { initialCodes: CodeRow[] }) {
  const [pending, startTransition] = useTransition();
  const [minted, setMinted] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [entitlements, setEntitlements] = useState("ai_import");

  function onMint(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMinted(null);
    startTransition(async () => {
      const res = await mintCodesAction({
        count,
        label: label.trim() || null,
        expiresAt: expiresAt || null,
        entitlements: entitlements
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (res.ok) setMinted(res.codes);
      else setError(res.error);
    });
  }

  function onRevoke(id: string) {
    if (!confirm("Revoke this code? It can no longer be redeemed.")) return;
    setError(null);
    startTransition(async () => {
      const res = await revokeCodeAction(id);
      if (!res.ok) setError(res.error);
    });
  }

  const col = createColumnHelper<CodeRow>();
  const columns = [
      col.accessor("label", {
        header: "Label",
        cell: (c) =>
          c.getValue() ? (
            c.getValue()
          ) : (
            <span className="text-neutral-500">—</span>
          ),
      }),
      col.accessor("createdAt", {
        header: "Created",
        cell: (c) => (
          <span className="tabular-nums font-mono text-xs">{fmt(c.getValue())}</span>
        ),
      }),
      col.accessor("expiresAt", {
        header: "Expires",
        cell: (c) => (
          <span className="tabular-nums font-mono text-xs">{fmt(c.getValue())}</span>
        ),
      }),
      col.accessor("status", {
        header: "Status",
        cell: (c) => (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.getValue()]}`}
          >
            {c.getValue()}
          </span>
        ),
      }),
      col.display({
        id: "redeemedBy",
        header: "Redeemed by",
        cell: (c) => {
          const r = c.row.original;
          return r.redeemedByUserId ? (
            <span className="font-mono text-xs text-neutral-400">
              {r.redeemedByUserId}
              {r.redeemedOrgId ? ` · ${r.redeemedOrgId}` : ""}
            </span>
          ) : (
            <span className="text-neutral-600">—</span>
          );
        },
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => {
          const r = c.row.original;
          if (r.status !== "unused" && r.status !== "expired") return null;
          return (
            <button
              onClick={() => onRevoke(r.id)}
              disabled={pending}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              Revoke
            </button>
          );
        },
      }),
  ];

  const table = useReactTable({
    data: initialCodes,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Beta Founder Codes</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Mint single-use codes and manage existing ones.
        </p>
      </header>

      {/* Mint form */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-300">Mint new codes</h2>
        <form onSubmit={onMint}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-neutral-400">Count</span>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-neutral-400">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Jane @ Acme"
                className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-neutral-400">Expires</span>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-neutral-100 focus:border-emerald-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-neutral-400">Entitlements</span>
              <input
                value={entitlements}
                onChange={(e) => setEntitlements(e.target.value)}
                placeholder="ai_import"
                className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-600 focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {pending ? "Minting…" : "Mint codes"}
            </button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </form>
      </section>

      {/* One-time reveal */}
      {minted && (
        <section className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium text-emerald-300">
              {minted.length === 1 ? "1 code minted" : `${minted.length} codes minted`}
            </h2>
            <button
              onClick={() => navigator.clipboard.writeText(minted.join("\n"))}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              Copy all
            </button>
          </div>
          <p className="mb-3 text-xs text-amber-300">
            Shown once — copy these now. They cannot be retrieved later.
          </p>
          <ul className="flex flex-col gap-1.5">
            {minted.map((c) => (
              <li
                key={c}
                className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-3 py-2"
              >
                <span className="font-mono text-sm tabular-nums">{c}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(c)}
                  className="text-xs text-neutral-400 hover:text-neutral-200"
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Codes table */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-300">
          All codes
          <span className="ml-2 tabular-nums font-mono text-neutral-500">
            ({initialCodes.length})
          </span>
        </h2>
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-sm text-neutral-500"
                    colSpan={6}
                  >
                    No codes yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
