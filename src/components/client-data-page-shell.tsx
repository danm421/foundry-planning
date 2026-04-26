import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  ChangesPanel,
  type ChangesPanelChange,
} from "@/components/scenario/changes-panel";
import type {
  CascadeWarning,
  TargetKind,
  ToggleGroup,
} from "@/engine/scenario/types";

// Layouts in Next 16 don't receive searchParams (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md),
// so each /client-data/<section>/page.tsx mounts this shell to opt into the
// scenario-aware right-rail panel.

interface PanelData {
  scenarioId: string;
  scenarioName: string;
  changes: ChangesPanelChange[];
  toggleGroups: ToggleGroup[];
  cascadeWarnings: CascadeWarning[];
  /** `${targetKind}:${targetId}` → entity display name, derived from the
   *  effective tree so leaf rows can render "Income — Salary" instead of
   *  the raw UUID slice. Built from `effective.effectiveTree`; entities the
   *  effective tree no longer contains (e.g. an op=remove target) gracefully
   *  fall back to the leaf row's UUID slice. */
  targetNames: Record<string, string>;
}

interface ClientDataPageShellProps {
  clientId: string;
  scenarioId?: string;
  children: React.ReactNode;
}

export default async function ClientDataPageShell({
  clientId,
  scenarioId,
  children,
}: ClientDataPageShellProps) {
  const panelData = scenarioId
    ? await loadPanelData(clientId, scenarioId)
    : null;

  if (!panelData) {
    return <>{children}</>;
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 min-w-0">
      <div className="min-w-0">{children}</div>
      <ChangesPanel
        clientId={clientId}
        scenarioId={panelData.scenarioId}
        scenarioName={panelData.scenarioName}
        changes={panelData.changes}
        toggleGroups={panelData.toggleGroups}
        cascadeWarnings={panelData.cascadeWarnings}
        targetNames={panelData.targetNames}
      />
    </div>
  );
}

// Returns null when the scenario id is bogus, doesn't belong to this firm, or
// resolves to the base case (the panel is suppressed for base — there's nothing
// to revert).
async function loadPanelData(
  clientId: string,
  scenarioId: string,
): Promise<PanelData | null> {
  const firmId = await requireOrgId();
  const client = await findClientInFirm(clientId, firmId);
  if (!client) return null;

  const [scenarioRow, changeRows, groupRows, effective] = await Promise.all([
    db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId)),
    db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, scenarioId))
      .orderBy(scenarioToggleGroups.orderIndex),
    loadEffectiveTree(clientId, firmId, scenarioId, {}),
  ]);

  if (!scenarioRow || scenarioRow.isBaseCase) return null;

  const changes: ChangesPanelChange[] = changeRows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    opType: r.opType,
    targetKind: r.targetKind as TargetKind,
    targetId: r.targetId,
    payload: r.payload,
    toggleGroupId: r.toggleGroupId,
    orderIndex: r.orderIndex,
    updatedAt: r.updatedAt,
  }));

  const toggleGroups: ToggleGroup[] = groupRows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    name: r.name,
    defaultOn: r.defaultOn,
    requiresGroupId: r.requiresGroupId,
    orderIndex: r.orderIndex,
  }));

  return {
    scenarioId,
    scenarioName: scenarioRow.name,
    changes,
    toggleGroups,
    cascadeWarnings: effective.warnings,
    targetNames: buildTargetNames(effective.effectiveTree, clientId),
  };
}

// Walks the effective tree's entity arrays + singletons and returns a flat
// `${kind}:${id}` → display name map for the Changes panel leaf rows. Entries
// for entities the panel never references (e.g. nothing was edited there) are
// harmless overhead. Op=remove targets are intentionally absent — the leaf row
// gracefully falls back to a UUID slice for those.
function buildTargetNames(
  tree: Awaited<ReturnType<typeof loadEffectiveTree>>["effectiveTree"],
  clientId: string,
): Record<string, string> {
  const names: Record<string, string> = {};
  const put = (kind: TargetKind, items: { id: string; name?: string | null }[]) => {
    for (const it of items) {
      if (it.name) names[`${kind}:${it.id}`] = it.name;
    }
  };
  put("account", tree.accounts);
  put("income", tree.incomes);
  put("expense", tree.expenses);
  put("liability", tree.liabilities);
  put("savings_rule", tree.savingsRules);
  if (tree.transfers) put("transfer", tree.transfers as { id: string; name?: string }[]);
  if (tree.assetTransactions) {
    put("asset_transaction", tree.assetTransactions as { id: string; name?: string }[]);
  }
  if (tree.gifts) put("gift", tree.gifts as { id: string; name?: string }[]);
  if (tree.wills) put("will", tree.wills as { id: string; name?: string }[]);
  if (tree.familyMembers) put("family_member", tree.familyMembers);
  if (tree.externalBeneficiaries) put("external_beneficiary", tree.externalBeneficiaries);
  if (tree.entities) put("entity", tree.entities as unknown as { id: string; name?: string }[]);
  if (tree.deductions) {
    put("client_deduction", tree.deductions as unknown as { id: string; name?: string }[]);
  }
  // Singletons. Client edits land on the client's row; the leaf row format
  // ("Client — <name>") wants the household first name. Plan-settings has
  // no natural display name; leave it to the UUID-slice fallback.
  if (tree.client?.firstName) {
    names[`client:${clientId}`] = tree.client.firstName;
  }
  return names;
}
