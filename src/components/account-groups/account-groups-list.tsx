"use client";

import { useMemo, useState } from "react";
import type { AssetAccount } from "@/components/account-groups/types";
import { buildAssetTree, type TreeNode } from "@/lib/account-groups/asset-tree";

export type CustomGroup = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  memberAccountIds: string[];
  illiquidMemberCount: number;
};

interface Props {
  allAccounts: AssetAccount[];
  customGroups: CustomGroup[];
  onCreate?: () => void;
  onEdit?: (groupId: string) => void;
  onDelete?: (groupId: string) => void;
}

// Custom groups are liquid-only by design; illiquid members are flagged via the
// "no longer eligible" badge and excluded from the displayed value/member list,
// preserving the value semantics from the pre-tree UI.
const LIQUID: ReadonlySet<AssetAccount["category"]> = new Set([
  "taxable",
  "cash",
  "retirement",
]);

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M4 2l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Keys of every branch (non-leaf) node, so we can expand the group hierarchy
// by default while leaving leaf nodes — which reveal individual accounts — closed.
function collectBranchKeys(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) =>
    n.children && n.children.length > 0
      ? [n.key, ...collectBranchKeys(n.children)]
      : [],
  );
}

export default function AccountGroupsList({
  allAccounts,
  customGroups,
  onCreate,
  onEdit,
  onDelete,
}: Props) {
  const tree = useMemo(() => buildAssetTree(allAccounts), [allAccounts]);
  // Start with every branch node expanded — the full group hierarchy is visible,
  // but leaf nodes stay collapsed so individual accounts only show on click.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(collectBranchKeys(tree)),
  );
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const accountsById = useMemo(() => {
    const m = new Map<string, AssetAccount>();
    for (const a of allAccounts) m.set(a.id, a);
    return m;
  }, [allAccounts]);

  function renderAccountRow(a: AssetAccount, indent: number) {
    return (
      <li
        key={a.id}
        className="flex items-center justify-between py-1.5 pr-4 text-sm"
        style={{ paddingLeft: indent }}
      >
        <span className="truncate text-ink-2">{a.name}</span>
        <span className="text-ink-3">${formatDollars(a.value)}</span>
      </li>
    );
  }

  function renderNode(node: TreeNode, depth: number) {
    const isOpen = expanded.has(node.key);
    const indent = 16 + depth * 18;
    const childIndent = 16 + (depth + 1) * 18;
    const expandable =
      (node.children?.length ?? 0) > 0 || (node.accounts?.length ?? 0) > 0;

    return (
      <li key={node.key}>
        <button
          type="button"
          onClick={() => expandable && toggle(node.key)}
          aria-expanded={expandable ? isOpen : undefined}
          disabled={!expandable}
          className="flex w-full items-center justify-between py-2 pr-4 text-sm hover:bg-card-2/40 disabled:cursor-default disabled:hover:bg-transparent"
          style={{ paddingLeft: indent }}
        >
          <span className="flex items-center gap-2 text-ink">
            {expandable ? (
              <Chevron open={isOpen} />
            ) : (
              <span className="inline-block h-3 w-3 shrink-0" />
            )}
            {node.label}
          </span>
          <span className="text-ink-3">
            {node.count} {node.count === 1 ? "account" : "accounts"} · $
            {formatDollars(node.value)}
          </span>
        </button>
        {isOpen && node.children && (
          <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
        {isOpen && node.accounts && node.accounts.length > 0 && (
          <ul>{node.accounts.map((a) => renderAccountRow(a, childIndent))}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
          Default groups (read-only)
        </h3>
        <ul className="divide-y divide-hair rounded-md border border-hair bg-card/40">
          {tree.map((node) => renderNode(node, 0))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
            Custom groups
          </h3>
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
            >
              + New group
            </button>
          )}
        </div>
        {customGroups.length === 0 ? (
          <p className="rounded-md border border-dashed border-hair bg-card/30 px-4 py-6 text-center text-sm text-ink-3">
            No custom groups yet. Use <em>+ New group</em> to bucket accounts.
          </p>
        ) : (
          <ul className="divide-y divide-hair rounded-md border border-hair bg-card/40">
            {customGroups.map((g) => {
              const key = `custom:${g.id}`;
              const isOpen = expanded.has(key);
              const members = g.memberAccountIds
                .map((id) => accountsById.get(id))
                .filter(
                  (a): a is AssetAccount => a != null && LIQUID.has(a.category),
                );
              const memberValue = members.reduce((s, a) => s + a.value, 0);
              const expandable = members.length > 0;
              return (
                <li key={g.id}>
                  <div className="flex items-center justify-between px-4 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => expandable && toggle(key)}
                      aria-expanded={expandable ? isOpen : undefined}
                      disabled={!expandable}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                    >
                      {expandable ? (
                        <Chevron open={isOpen} />
                      ) : (
                        <span className="inline-block h-3 w-3 shrink-0" />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2 text-ink">
                          <span style={{ color: g.color ?? undefined }}>●</span>
                          <span className="truncate">{g.name}</span>
                          {g.illiquidMemberCount > 0 && (
                            <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-yellow-300">
                              {g.illiquidMemberCount} no longer eligible
                            </span>
                          )}
                        </span>
                        {g.description && (
                          <span className="truncate text-xs text-ink-3">
                            {g.description}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex items-center gap-4 pl-4">
                      <span className="text-ink-3">
                        {g.memberAccountIds.length}{" "}
                        {g.memberAccountIds.length === 1 ? "account" : "accounts"}{" "}
                        · ${formatDollars(memberValue)}
                      </span>
                      {onEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(g.id)}
                          className="text-xs text-ink-2 hover:text-ink"
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(g.id)}
                          className="text-xs text-crit hover:opacity-80"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && members.length > 0 && (
                    <ul>{members.map((a) => renderAccountRow(a, 16 + 18))}</ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
