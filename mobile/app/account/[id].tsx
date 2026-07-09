import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { AccountsOverviewDTO, PortalTransactionDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchAccountsOverview, fetchTransactions } from "@/api/portal";
import { ForbiddenError } from "@/api/client";
import { formatMoney } from "@/ui/money";
import { formatDay } from "@/ui/date";
import { Row } from "@/ui/row";
import { EmptyState } from "@/ui/empty-state";
import { categoryLabel, debtTypeLabel, subTypeLabel } from "@/accounts/labels";

type TxnState = "loading" | "ok" | "private" | "error";

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();

  const [data, setData] = useState<AccountsOverviewDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchAccountsOverview(api));
    } catch {
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const asset = data?.assets.find((a) => a.id === id) ?? null;
  const debt = !asset ? (data?.debts.find((d) => d.id === id) ?? null) : null;

  const [txns, setTxns] = useState<PortalTransactionDTO[]>([]);
  const [txnState, setTxnState] = useState<TxnState>("loading");

  useEffect(() => {
    if (!asset) return;
    let live = true;
    setTxnState("loading");
    fetchTransactions(api, { limit: 10, offset: 0, accountId: id })
      .then((page) => {
        if (!live) return;
        setTxns(page.transactions);
        setTxnState("ok");
      })
      .catch((e) => {
        if (!live) return;
        setTxnState(e instanceof ForbiddenError ? "private" : "error");
      });
    return () => {
      live = false;
    };
  }, [api, asset, id]);

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
            <Text className="text-ink-2">Couldn't load this account.</Text>
            <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
          </View>
        ) : data ? (
          <>
            {error ? (
              <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
            ) : null}

            {asset ? (
              <>
                <Text className="text-ink text-xl font-semibold">
                  {asset.name}
                  {asset.last4 ? <Text className="text-ink-3 text-sm"> ••{asset.last4}</Text> : null}
                </Text>
                <Text className="text-ink text-3xl font-semibold mt-2">{formatMoney(asset.value)}</Text>

                <View className="mt-6">
                  <Row label="Category" value={categoryLabel(asset.category)} />
                  <Row label="Type" value={subTypeLabel(asset.subType)} />
                  {asset.isPlaidLinked ? (
                    <Row label="Balance" value="Synced from your institution" />
                  ) : null}
                </View>

                <View className="mt-6">
                  <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Recent activity</Text>
                  {txnState === "loading" ? (
                    <ActivityIndicator />
                  ) : txnState === "private" ? (
                    <Text className="text-ink-4">Transactions are private.</Text>
                  ) : txnState === "error" ? (
                    <Text className="text-ink-4">Couldn't load recent activity.</Text>
                  ) : txns.length === 0 ? (
                    <Text className="text-ink-4">No transactions for this account yet.</Text>
                  ) : (
                    txns.map((t) => (
                      <Row
                        key={t.id}
                        label={t.merchantName ?? t.name}
                        sublabel={formatDay(t.date)}
                        value={formatMoney(Number(t.amount), { cents: true })}
                      />
                    ))
                  )}
                </View>
              </>
            ) : debt ? (
              <>
                <Text className="text-ink text-xl font-semibold">{debt.name}</Text>
                <Text className="text-ink text-3xl font-semibold mt-2">{formatMoney(debt.balance)}</Text>

                <View className="mt-6">
                  <Row label="Type" value={debtTypeLabel(debt.liabilityType)} />
                  {debt.aprPercentage != null ? (
                    <Row label="APR" value={`${debt.aprPercentage.toFixed(2)}%`} />
                  ) : null}
                  {debt.statementBalance != null ? (
                    <Row label="Statement balance" value={formatMoney(debt.statementBalance)} />
                  ) : null}
                  {debt.minimumPayment != null ? (
                    <Row label="Minimum payment" value={formatMoney(debt.minimumPayment)} />
                  ) : null}
                  {debt.nextPaymentDueDate != null ? (
                    <Row label="Next payment" value={formatDay(debt.nextPaymentDueDate)} />
                  ) : null}
                  {debt.isPlaidLinked ? (
                    <Row label="Balance" value="Synced from your institution" />
                  ) : null}
                </View>
              </>
            ) : (
              <EmptyState title="Account not found" hint="It may have been removed or unlinked." />
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
