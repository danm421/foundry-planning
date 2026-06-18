"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import type { OrgRow } from "@/lib/ops/org-rows";

const STATUS_STYLE: Record<string, string> = {
  founder: "bg-violet-500/15 text-violet-300",
  active: "bg-emerald-500/15 text-emerald-300",
  trialing: "bg-sky-500/15 text-sky-300",
  past_due: "bg-amber-500/15 text-amber-300",
  unpaid: "bg-amber-500/15 text-amber-300",
  none: "bg-ink-4/15 text-ink-2",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const col = createColumnHelper<OrgRow>();

export default function OrgsClient({ rows }: { rows: OrgRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.displayName.toLowerCase().includes(q) || r.firmId.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns = useMemo(
    () => [
      col.accessor("displayName", {
        header: "Organization",
        cell: (c) => (
          <Link href={`/admin/orgs/${c.row.original.firmId}`} className="text-accent hover:underline">
            {c.getValue()}
          </Link>
        ),
      }),
      col.accessor("subscriptionStatus", {
        header: "Status",
        cell: (c) => (
          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[c.getValue()] ?? STATUS_STYLE.none}`}>
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor("trialEnd", { header: "Trial ends", cell: (c) => fmt(c.getValue()) }),
      col.accessor("createdAt", { header: "Created", cell: (c) => fmt(c.getValue()) }),
      col.accessor("firmId", {
        header: "Org ID",
        cell: (c) => <span className="tabular text-xs text-ink-3">{c.getValue()}</span>,
      }),
    ],
    [],
  );

  const table = useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium text-ink">Organizations</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or org id…"
          className="rounded border border-hair-2 bg-card-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
      </div>
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-ink-3">
                  No organizations match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
