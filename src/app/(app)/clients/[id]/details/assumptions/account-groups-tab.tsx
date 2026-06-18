"use client";

import { useCallback, useEffect, useState } from "react";
import AccountGroupsList, {
  type CustomGroup,
} from "@/components/account-groups/account-groups-list";
import AccountGroupForm, {
  type GroupFormInitial,
} from "@/components/account-groups/account-group-form";
import type { LiquidAccount, AssetAccount } from "@/components/account-groups/types";
import { useClientAccess } from "@/components/client-access-provider";

interface Props {
  clientId: string;
  liquidAccounts: LiquidAccount[];
  allAccounts: AssetAccount[];
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; group: GroupFormInitial };

export default function AccountGroupsTab({ clientId, liquidAccounts, allAccounts }: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const [groups, setGroups] = useState<CustomGroup[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/account-groups`);
      if (!res.ok) throw new Error(`Failed to load groups (${res.status})`);
      const data = (await res.json()) as CustomGroup[];
      setGroups(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [clientId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const handleDelete = useCallback(
    async (groupId: string) => {
      if (!confirm("Delete this group? This cannot be undone.")) return;
      try {
        const res = await fetch(
          `/api/clients/${clientId}/account-groups/${groupId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          setError(`Failed to delete (${res.status})`);
          return;
        }
        await refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [clientId, refetch],
  );

  if (mode.kind === "create" || mode.kind === "edit") {
    return (
      <AccountGroupForm
        clientId={clientId}
        liquidAccounts={liquidAccounts}
        initial={mode.kind === "edit" ? mode.group : undefined}
        onCancel={() => setMode({ kind: "list" })}
        onDone={() => {
          setMode({ kind: "list" });
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded border border-red-700 bg-red-900/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <AccountGroupsList
        allAccounts={allAccounts}
        customGroups={groups ?? []}
        onCreate={canEdit ? () => setMode({ kind: "create" }) : undefined}
        onEdit={canEdit ? (groupId) => {
          const g = (groups ?? []).find((x) => x.id === groupId);
          if (!g) return;
          setMode({
            kind: "edit",
            group: {
              id: g.id,
              name: g.name,
              description: g.description,
              color: g.color,
              memberAccountIds: g.memberAccountIds,
            },
          });
        } : undefined}
        onDelete={canEdit ? handleDelete : undefined}
      />
    </div>
  );
}
