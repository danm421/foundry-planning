// mobile/src/plaid/account-picker.tsx
//
// Streamlined post-link account picker. After Plaid Link returns the
// discovered accounts (Task 5's exchange payload), this lets the client
// include/skip each one and, optionally, link a same-kind existing
// account/debt instead of creating a new one. This is the mobile
// "streamlined" picker — no manual category/subType tree (that's the
// web-only full picker, out of scope here). Decision-building is fully
// delegated to buildDecisions (Task 6, already unit-tested) — this
// component only tracks per-account UI selection state and posts the
// commit.

import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import type {
  PlaidLinkCandidate,
  PlaidLinkSuccessPayload,
  PlaidLiabilityCandidate,
  PlaidMappedAccount,
} from "@contracts";
import type { PickerSelection } from "@/plaid/build-decisions";
import { buildDecisions } from "@/plaid/build-decisions";
import { mapPlaidToFoundry, mapPlaidToLiability } from "@/plaid/account-mapping";
import { categoryLabel, debtTypeLabel, subTypeLabel } from "@/accounts/labels";
import { commitExchange } from "@/api/portal";
import { useApi } from "@/api/context";
import { Row } from "@/ui/row";
import { EmptyState } from "@/ui/empty-state";

/** Read-only suggested-type sublabel: debt types win (mapPlaidToLiability),
 *  otherwise fall back to the asset category/subType — mirrors the
 *  create-decision precedence in buildDecisions itself. */
function suggestedTypeLabel(account: PlaidMappedAccount): string {
  const liability = mapPlaidToLiability(account.type, account.subtype);
  if (liability) return debtTypeLabel(liability.liabilityType);
  const asset = mapPlaidToFoundry(account.type, account.subtype) ?? { category: "cash" as const, subType: "other" as const };
  return `${categoryLabel(asset.category)} · ${subTypeLabel(asset.subType)}`;
}

function initialSelection(accounts: PlaidMappedAccount[]): PickerSelection {
  const selection: PickerSelection = {};
  for (const a of accounts) selection[a.plaidAccountId] = { included: true };
  return selection;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={
        active
          ? "bg-accent-wash border border-accent rounded-full px-3 py-1 mr-2"
          : "bg-card-2 border border-hair rounded-full px-3 py-1 mr-2"
      }
    >
      <Text className={active ? "text-accent-ink text-xs" : "text-ink-3 text-xs"} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function AccountPickerRow({
  account,
  sel,
  isLast,
  existingCandidates,
  existingLiabilityCandidates,
  onToggleIncluded,
  onSetLinkTarget,
}: {
  account: PlaidMappedAccount;
  sel: PickerSelection[string];
  isLast: boolean;
  existingCandidates: PlaidLinkCandidate[];
  existingLiabilityCandidates: PlaidLiabilityCandidate[];
  onToggleIncluded: (included: boolean) => void;
  onSetLinkTarget: (targetId: string | null, kind: "account" | "liability") => void;
}) {
  const isDebt = mapPlaidToLiability(account.type, account.subtype) != null;
  const candidates: Array<{ id: string; name: string }> = isDebt ? existingLiabilityCandidates : existingCandidates;
  const linkKind: "account" | "liability" = isDebt ? "liability" : "account";
  const sublabel = [account.mask ? `··${account.mask}` : null, suggestedTypeLabel(account)]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className={isLast ? "py-3" : "py-3 border-b border-hair"}>
      <Row
        label={account.name}
        sublabel={sublabel}
        right={<Switch value={sel.included} onValueChange={onToggleIncluded} />}
      />
      {sel.included && candidates.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-1">
          <Chip label="Add as new" active={!sel.linkTargetId} onPress={() => onSetLinkTarget(null, linkKind)} />
          {candidates.map((c) => (
            <Chip
              key={c.id}
              label={`Link: ${c.name}`}
              active={sel.linkTargetId === c.id}
              onPress={() => onSetLinkTarget(c.id, linkKind)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function PlaidAccountPicker({
  payload,
  onDone,
  onCancel,
}: {
  payload: PlaidLinkSuccessPayload;
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const [selection, setSelection] = useState<PickerSelection>(() => initialSelection(payload.accounts));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const includedCount = useMemo(
    () => Object.values(selection).filter((s) => s.included).length,
    [selection],
  );

  function setIncluded(id: string, included: boolean) {
    setSelection((prev) => ({
      ...prev,
      // Turning a row back off clears any link choice it had picked up.
      [id]: included ? { ...prev[id], included: true } : { included: false },
    }));
  }

  function setLinkTarget(id: string, linkTargetId: string | null, linkKind: "account" | "liability") {
    setSelection((prev) => ({
      ...prev,
      [id]: linkTargetId ? { included: true, linkTargetId, linkKind } : { included: true },
    }));
  }

  async function handleSave() {
    if (saving || includedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const decisions = buildDecisions(payload.accounts, selection);
      await commitExchange(api, { itemId: payload.itemId, decisions });
      onDone();
    } catch {
      setError("Couldn't save your accounts. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-paper pt-16 px-4">
        <Text className="text-ink text-2xl font-semibold mb-1">Link your accounts</Text>
        <Text className="text-ink-3 mb-4">Choose which accounts to add.</Text>

        {payload.accounts.length === 0 ? (
          <EmptyState title="No accounts found" hint="This institution didn't return any accounts to link." />
        ) : (
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 16 }}>
            <View className="bg-card border border-hair rounded-2xl px-4">
              {payload.accounts.map((a, i) => (
                <AccountPickerRow
                  key={a.plaidAccountId}
                  account={a}
                  sel={selection[a.plaidAccountId] ?? { included: true }}
                  isLast={i === payload.accounts.length - 1}
                  existingCandidates={payload.existingCandidates}
                  existingLiabilityCandidates={payload.existingLiabilityCandidates}
                  onToggleIncluded={(included) => setIncluded(a.plaidAccountId, included)}
                  onSetLinkTarget={(targetId, kind) => setLinkTarget(a.plaidAccountId, targetId, kind)}
                />
              ))}
            </View>
          </ScrollView>
        )}

        {error ? <Text className="text-warn mb-2">{error}</Text> : null}

        <View className="flex-row items-center justify-between py-4 border-t border-hair">
          <Text className="text-ink-3">
            {includedCount} of {payload.accounts.length} selected
          </Text>
          <View className="flex-row items-center">
            <Pressable onPress={onCancel} disabled={saving} hitSlop={8} className="px-4 py-2">
              <Text className={saving ? "text-ink-4" : "text-ink-2"}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving || includedCount === 0}
              hitSlop={8}
              className="px-4 py-2"
            >
              {saving ? (
                <ActivityIndicator />
              ) : (
                <Text className={includedCount === 0 ? "text-ink-4" : "text-accent-ink"}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
