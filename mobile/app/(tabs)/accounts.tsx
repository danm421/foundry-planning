import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { AccountsOverviewDTO, PlaidItemDTO } from "@contracts";
import { useApi } from "@/api/context";
import { useMe } from "@/auth/me-gate";
import { fetchAccountsOverview, fetchPlaidItems } from "@/api/portal";
import { usePlaidLink } from "@/plaid/use-plaid-link";
import { PlaidAccountPicker } from "@/plaid/account-picker";
import { formatMoney } from "@/ui/money";
import { Tile } from "@/home/tiles";
import { Row } from "@/ui/row";
import { EmptyState } from "@/ui/empty-state";
import { categoryLabel, debtTypeLabel, orderedCategories, subTypeLabel } from "@/accounts/labels";

/** Relative "last refreshed" label from an ISO timestamp. Mirrors the web
 *  institutions-section.tsx formatRelative, but takes an ISO string (the
 *  wire format — see PlaidItemDTO.lastRefreshedAt) instead of a Date, and
 *  omits the "Last refreshed" prefix since callers prepend "Updated ". */
function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (hours < 1) return "just now";
  if (hours === 1) return "1h ago";
  return `${hours}h ago`;
}

/** Status sublabel + tone for a linked institution, in priority order:
 *  revoked > needs reauth > new accounts available > last-refreshed time. */
function statusFor(item: PlaidItemDTO): { label: string; className: string } {
  if (item.revoked) return { label: "Access revoked", className: "text-warn" };
  if (item.needsReauth) return { label: "Reconnect required", className: "text-warn" };
  if (item.newAccountsAvailable) return { label: "New accounts available", className: "text-accent-ink" };
  return { label: `Updated ${formatRelative(item.lastRefreshedAt)}`, className: "text-ink-4" };
}

function QuickAction({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      className={`border border-hair rounded-lg px-3 py-1.5 ${disabled ? "opacity-50" : ""}`}
    >
      <Text className="text-accent-ink text-xs font-medium">{label}</Text>
    </Pressable>
  );
}

export default function Accounts() {
  const api = useApi();
  const router = useRouter();
  const me = useMe();
  const plaidLink = usePlaidLink();

  const [data, setData] = useState<AccountsOverviewDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Own data/error/refreshing state for linked institutions — independent of
  // the accounts-overview load above, so a failure in one doesn't corrupt
  // the other. `plaidRefreshing` is separate from the pull-to-refresh
  // `refreshing` flag above because items also reload outside a pull
  // gesture (after a reauth/account-selection session completes).
  const [plaidItems, setPlaidItems] = useState<PlaidItemDTO[] | null>(null);
  const [plaidItemsError, setPlaidItemsError] = useState(false);
  const [plaidRefreshing, setPlaidRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchAccountsOverview(api));
    } catch {
      setError(true);
    }
  }, [api]);

  const loadPlaidItems = useCallback(async () => {
    setPlaidRefreshing(true);
    try {
      setPlaidItemsError(false);
      setPlaidItems(await fetchPlaidItems(api));
    } catch {
      setPlaidItemsError(true);
    } finally {
      setPlaidRefreshing(false);
    }
  }, [api]);

  // Re-syncs on every focus (initial mount counts as the first focus, so this
  // also covers the mount load) — this is what picks up changes made in the
  // manage-bank modal (detach/add/unlink), since expo-router keeps this tab
  // mounted underneath and a plain mount effect would never re-fire on return.
  useFocusEffect(
    useCallback(() => {
      void load();
      void loadPlaidItems();
    }, [load, loadPlaidItems]),
  );

  // Re-entrant guard: the hook has no internal lock, so gate every open()
  // trigger on its own status while a Link session is already in flight.
  const linking = plaidLink.status === "opening" || plaidLink.status === "in-progress";

  // This screen drives usePlaidLink in "link" mode too (the CTA below), and
  // a successful link surfaces its own reload via the picker's onDone — so
  // only auto-reload here for the reauth/account-selection tail, i.e. a
  // "done" transition with no picker payload pending. Reading pickerPayload
  // (rather than listing it as a dependency) avoids re-firing this effect
  // when clearPicker() flips it back to null after that reload already ran.
  useEffect(() => {
    if (plaidLink.status === "done" && plaidLink.pickerPayload === null) {
      void loadPlaidItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plaidLink.status]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), loadPlaidItems()]);
    setRefreshing(false);
  }, [load, loadPlaidItems]);

  const groups = data
    ? orderedCategories(data.assets.map((a) => a.category)).map((category) => ({
        category,
        rows: data.assets.filter((a) => a.category === category),
      }))
    : [];

  function quickActionFor(item: PlaidItemDTO) {
    if (!me.editEnabled || item.revoked) return undefined;
    if (item.needsReauth) {
      return (
        <QuickAction
          label="Reconnect"
          disabled={linking || plaidRefreshing}
          onPress={() => void plaidLink.open({ mode: "reauth", itemId: item.id })}
        />
      );
    }
    if (item.newAccountsAvailable) {
      return (
        <QuickAction
          label="Add"
          disabled={linking || plaidRefreshing}
          onPress={() => void plaidLink.open({ mode: "account-selection", itemId: item.id })}
        />
      );
    }
    return undefined;
  }

  return (
    <>
      <ScrollView
        className="flex-1 bg-paper px-4"
        contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
      >
        <Text className="text-ink text-2xl font-semibold mb-4">Accounts</Text>

        {me.editEnabled ? (
          <Pressable
            className={`bg-accent rounded-xl px-4 py-2.5 mb-3 self-start ${linking ? "opacity-50" : ""}`}
            disabled={linking}
            onPress={() => void plaidLink.open({ mode: "link" })}
          >
            {linking ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Link a bank</Text>}
          </Pressable>
        ) : null}

        {plaidLink.error ? <Text className="text-warn mb-3">{plaidLink.error}</Text> : null}

        {plaidItems && plaidItems.length > 0 ? (
          <Tile title="Linked banks">
            {plaidItemsError ? (
              <Text className="text-warn mb-2">Couldn't refresh. Pull down to try again.</Text>
            ) : null}
            {plaidItems.map((item) => {
              const status = statusFor(item);
              return (
                <Row
                  key={item.id}
                  label={item.institutionName ?? "Bank"}
                  sublabel={status.label}
                  sublabelClassName={status.className}
                  onPress={() =>
                    router.push({
                      pathname: "/plaid/[itemId]",
                      params: { itemId: item.id, needsTransactionsConsent: item.needsTransactionsConsent ? "1" : "" },
                    })
                  }
                  right={quickActionFor(item)}
                />
              );
            })}
          </Tile>
        ) : null}

        {data === null && !error ? (
          <View className="py-24 items-center">
            <ActivityIndicator />
          </View>
        ) : data === null && error ? (
          <View className="py-24 items-center">
            <Text className="text-ink-2">Couldn't load your accounts.</Text>
            <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
          </View>
        ) : data ? (
          <>
            {error ? (
              <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
            ) : null}

            {data.assets.length === 0 && data.debts.length === 0 ? (
              <EmptyState title="No accounts yet" hint="Linked accounts will show up here." />
            ) : (
              <>
                <Tile title="Net worth">
                  <Text className="text-ink text-3xl font-semibold">{formatMoney(data.netWorth.netWorth)}</Text>
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-ink-3">Assets {formatMoney(data.netWorth.assets)}</Text>
                    <Text className="text-ink-3">Debt {formatMoney(data.netWorth.debt)}</Text>
                  </View>
                </Tile>

                {data.assets.length > 0 ? (
                  <Tile title="Assets">
                    {groups.map(({ category, rows }, i) => (
                      <View key={category} className={i === 0 ? undefined : "mt-4"}>
                        <View className="flex-row justify-between items-baseline mb-1">
                          <Text className="text-ink-3 text-xs uppercase tracking-wide">
                            {categoryLabel(category)}
                          </Text>
                          <Text className="text-ink-3 text-xs">
                            {formatMoney(rows.reduce((sum, a) => sum + a.value, 0))}
                          </Text>
                        </View>
                        {rows.map((a) => (
                          <Row
                            key={a.id}
                            label={a.name}
                            sublabel={subTypeLabel(a.subType)}
                            value={formatMoney(a.value)}
                            valueSub={a.last4 ? `••${a.last4}` : null}
                            onPress={() => router.push(`/account/${a.id}`)}
                          />
                        ))}
                      </View>
                    ))}
                  </Tile>
                ) : null}

                {data.debts.length > 0 ? (
                  <Tile title="Debts">
                    {data.debts.map((d) => (
                      <Row
                        key={d.id}
                        label={d.name}
                        sublabel={debtTypeLabel(d.liabilityType)}
                        value={formatMoney(d.balance)}
                        onPress={() => router.push(`/account/${d.id}`)}
                      />
                    ))}
                  </Tile>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      {plaidLink.pickerPayload ? (
        <PlaidAccountPicker
          payload={plaidLink.pickerPayload}
          onDone={() => {
            plaidLink.clearPicker();
            void loadPlaidItems();
            void load();
          }}
          onCancel={plaidLink.clearPicker}
        />
      ) : null}
    </>
  );
}
