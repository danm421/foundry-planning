"use client";

import { useMemo } from "react";

type LiquidAccount = {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement";
  value: number;
};

export type CustomGroup = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  memberAccountIds: string[];
  illiquidMemberCount: number;
};

interface Props {
  liquidAccounts: LiquidAccount[];
  customGroups: CustomGroup[];
  onCreate: () => void;
  onEdit: (groupId: string) => void;
  onDelete: (groupId: string) => void;
}

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function AccountGroupsList({
  liquidAccounts,
  customGroups,
  onCreate,
  onEdit,
  onDelete,
}: Props) {
  const { defaults, memberValuesById } = useMemo(() => {
    const counts: Record<"taxable" | "cash" | "retirement", number> = { taxable: 0, cash: 0, retirement: 0 };
    const values: Record<"taxable" | "cash" | "retirement", number> = { taxable: 0, cash: 0, retirement: 0 };
    const map = new Map<string, number>();
    for (const a of liquidAccounts) {
      counts[a.category] += 1;
      values[a.category] += a.value;
      map.set(a.id, a.value);
    }
    return {
      defaults: [
        { key: "all-liquid", label: "All Liquid Assets", count: liquidAccounts.length, value: values.taxable + values.cash + values.retirement },
        { key: "taxable",    label: "Taxable",            count: counts.taxable,    value: values.taxable },
        { key: "retirement", label: "Retirement",         count: counts.retirement, value: values.retirement },
        { key: "cash",       label: "Cash",               count: counts.cash,       value: values.cash },
      ],
      memberValuesById: map,
    };
  }, [liquidAccounts]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-300">
          Default groups (read-only)
        </h3>
        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/40">
          {defaults.map((g) => (
            <li key={g.key} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-gray-100">● {g.label}</span>
              <span className="text-gray-400">
                {g.count} {g.count === 1 ? "account" : "accounts"} · ${formatDollars(g.value)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
            Custom groups
          </h3>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
          >
            + New group
          </button>
        </div>
        {customGroups.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-700 bg-gray-900/30 px-4 py-6 text-center text-sm text-gray-400">
            No custom groups yet. Use <em>+ New group</em> to bucket accounts.
          </p>
        ) : (
          <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/40">
            {customGroups.map((g) => {
              const memberValue = g.memberAccountIds
                .reduce((s, id) => s + (memberValuesById.get(id) ?? 0), 0);
              return (
                <li key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-gray-100">
                      <span style={{ color: g.color ?? undefined }}>●</span>
                      <span className="truncate">{g.name}</span>
                      {g.illiquidMemberCount > 0 && (
                        <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-yellow-300">
                          {g.illiquidMemberCount} no longer eligible
                        </span>
                      )}
                    </div>
                    {g.description && (
                      <div className="truncate text-xs text-gray-400">{g.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-gray-400">
                      {g.memberAccountIds.length}{" "}
                      {g.memberAccountIds.length === 1 ? "account" : "accounts"} · $
                      {formatDollars(memberValue)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEdit(g.id)}
                      className="text-xs text-gray-300 hover:text-white"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(g.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
