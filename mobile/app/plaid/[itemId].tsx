// mobile/app/plaid/[itemId].tsx
//
// Manage-accounts modal for one linked Plaid item — full parity with the web
// ManageAccountsDialog + InstitutionRow: detach/add individual accounts,
// reconnect, enable spending insights, refresh, unlink. Root-level modal
// (Stack sibling of (tabs), outside MeGate) — editEnabled is fetched locally
// (fail-closed), same pattern as category/[id].tsx.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { PlaidItemAccountsDTO, PlaidLinkSuccessPayload, PortalMeDTO } from "@contracts";
import { useApi } from "@/api/context";
import { detachAccount, fetchItemAccounts, fetchMe, refreshItem, unlinkItem } from "@/api/portal";
import { ApiError } from "@/api/client";
import { usePlaidLink } from "@/plaid/use-plaid-link";
import { PlaidAccountPicker } from "@/plaid/account-picker";
import { Row } from "@/ui/row";
import { formatMoney } from "@/ui/money";

/** Shape of refreshPlaidItemData's failure branch, forwarded verbatim by the
 *  /refresh route. Narrowed via a user-defined guard since refreshItem's
 *  return type is `unknown` (Task 5 doesn't export RefreshItemDataResult). */
function isRefreshFailure(result: unknown): result is { ok: false; needsReauth?: boolean } {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

export default function ManageAccountsModal() {
  const { itemId, needsTransactionsConsent } = useLocalSearchParams<{
    itemId: string;
    needsTransactionsConsent?: string;
  }>();
  const api = useApi();
  const router = useRouter();
  const plaidLink = usePlaidLink();

  const [data, setData] = useState<PlaidItemAccountsDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // The modal is a Stack sibling of (tabs), outside the MeGate provider that
  // scopes `useMe()` to the tab bar's subtree — fetch editEnabled directly
  // rather than crashing on a missing context. Fails closed: no edit/
  // destructive affordance until this resolves true.
  const [me, setMe] = useState<PortalMeDTO | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchItemAccounts(api, itemId));
    } catch {
      setError(true);
    }
  }, [api, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    fetchMe(api)
      .then((m) => {
        if (live) setMe(m);
      })
      .catch(() => {
        // Edit affordances simply stay hidden; the rest of the modal still works.
      });
    return () => {
      live = false;
    };
  }, [api]);

  // This screen never drives usePlaidLink in "link" mode (that's the
  // fresh-institution flow elsewhere) — so any transition to "done" here is
  // the tail of a reauth or enable-products session. Reload to pick up the
  // now-current needsReauth / needsTransactionsConsent state.
  useEffect(() => {
    if (plaidLink.status === "done") void load();
  }, [plaidLink.status, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const canEdit = me?.editEnabled === true;
  // Re-entrant guard: the hook has no internal lock, so gate every open()
  // trigger on its own status while a Link session is already in flight.
  const linking = plaidLink.status === "opening" || plaidLink.status === "in-progress";
  const wantsEnableProducts = needsTransactionsConsent === "1" || needsTransactionsConsent === "true";

  async function handleDetach(plaidAccountId: string) {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await detachAccount(api, itemId, plaidAccountId);
      await load();
    } catch {
      setActionError("Couldn't remove that account. Try again.");
    } finally {
      setActionPending(false);
    }
  }

  async function handleRefresh() {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const result = await refreshItem(api, itemId);
      if (isRefreshFailure(result)) {
        if (result.needsReauth) {
          setData((prev) => (prev ? { ...prev, needsReauth: true } : prev));
        } else {
          setActionError("Refresh failed. Try again.");
        }
      } else {
        await load();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setData((prev) => (prev ? { ...prev, needsReauth: true } : prev));
      } else {
        setActionError("Refresh failed. Try again.");
      }
    } finally {
      setActionPending(false);
    }
  }

  function handleUnlink() {
    if (!data) return;
    Alert.alert(
      "Unlink bank",
      `Unlink ${data.institutionName ?? "this bank"}? Its linked accounts become manually-maintained.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setActionPending(true);
              setActionError(null);
              try {
                await unlinkItem(api, itemId);
                router.back();
              } catch {
                setActionError("Unlink failed. Try again.");
                setActionPending(false);
              }
            })();
          },
        },
      ],
    );
  }

  const pickerPayload: PlaidLinkSuccessPayload | null =
    data && data.available.length > 0
      ? {
          itemId,
          accounts: data.available,
          existingCandidates: data.existingCandidates,
          existingLiabilityCandidates: data.existingLiabilityCandidates,
        }
      : null;

  return (
    <View className="flex-1 bg-paper">
      <View className="flex-row justify-end px-4 pt-4">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text className="text-accent-ink">Close</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
      >
        {data === null && !error ? (
          <View className="py-24 items-center">
            <ActivityIndicator />
          </View>
        ) : data === null && error ? (
          <View className="py-24 items-center">
            <Text className="text-ink-2">Couldn't load accounts.</Text>
            <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
          </View>
        ) : data ? (
          <>
            {error ? (
              <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
            ) : null}

            <Text className="text-ink text-xl font-semibold mb-4">
              Manage {data.institutionName ?? "bank"} accounts
            </Text>

            {data.needsReauth ? (
              <View className="bg-card border border-hair rounded-2xl p-4 mb-4">
                <Text className="text-warn font-semibold">Reconnect required</Text>
                <Text className="text-ink-3 mt-1">
                  This institution needs to be reconnected before balances can update.
                </Text>
                {canEdit ? (
                  <Pressable
                    className={`bg-accent rounded-xl px-4 py-2 mt-3 self-start ${linking ? "opacity-50" : ""}`}
                    disabled={linking}
                    onPress={() => void plaidLink.open({ mode: "reauth", itemId })}
                  >
                    {linking ? (
                      <ActivityIndicator />
                    ) : (
                      <Text className="text-paper font-semibold">Reconnect</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {canEdit && wantsEnableProducts && !data.needsReauth ? (
              <Pressable
                className={`border border-hair rounded-xl px-4 py-2 mb-4 self-start ${linking ? "opacity-50" : ""}`}
                disabled={linking}
                onPress={() => void plaidLink.open({ mode: "enable-products", itemId })}
              >
                {linking ? <ActivityIndicator /> : <Text className="text-ink-2">Enable spending insights</Text>}
              </Pressable>
            ) : null}

            {plaidLink.error ? <Text className="text-crit mb-3">{plaidLink.error}</Text> : null}
            {actionError ? <Text className="text-crit mb-3">{actionError}</Text> : null}

            <View className="mt-2">
              <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Linked accounts</Text>
              {data.linked.length === 0 ? (
                <Text className="text-ink-4">No linked accounts yet.</Text>
              ) : (
                <View className="bg-card border border-hair rounded-2xl px-4">
                  {data.linked.map((l, i) => (
                    <View
                      key={l.plaidAccountId}
                      className={i === data.linked.length - 1 ? "" : "border-b border-hair"}
                    >
                      <Row
                        label={l.name}
                        sublabel={l.mask ? `••${l.mask}` : null}
                        right={
                          <View className="items-end">
                            <Text className="text-ink" numberOfLines={1}>
                              {formatMoney(l.value)}
                            </Text>
                            {canEdit ? (
                              <Pressable
                                onPress={() => void handleDetach(l.plaidAccountId)}
                                disabled={actionPending}
                                hitSlop={8}
                                className="mt-1"
                              >
                                <Text className={actionPending ? "text-ink-4 text-xs" : "text-crit text-xs"}>
                                  Remove
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>

            {pickerPayload && canEdit ? (
              <Pressable
                className="border border-hair rounded-xl px-4 py-2 mt-4 self-start"
                onPress={() => setShowPicker(true)}
              >
                <Text className="text-accent-ink">Add accounts ({data.available.length})</Text>
              </Pressable>
            ) : null}

            {canEdit ? (
              <View className="flex-row mt-6">
                {!data.needsReauth ? (
                  <Pressable
                    className={`border border-hair rounded-xl px-4 py-2 mr-3 ${actionPending ? "opacity-50" : ""}`}
                    disabled={actionPending}
                    onPress={() => void handleRefresh()}
                  >
                    <Text className="text-ink-2">Refresh</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  className={`border border-hair rounded-xl px-4 py-2 ${actionPending ? "opacity-50" : ""}`}
                  disabled={actionPending}
                  onPress={handleUnlink}
                >
                  <Text className="text-crit">Unlink bank</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {showPicker && pickerPayload ? (
        <PlaidAccountPicker
          payload={pickerPayload}
          onDone={() => {
            setShowPicker(false);
            void load();
          }}
          onCancel={() => setShowPicker(false)}
        />
      ) : null}
    </View>
  );
}
