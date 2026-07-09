import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { AccountsOverviewDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchAccountsOverview } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { Tile } from "@/home/tiles";
import { Row } from "@/ui/row";
import { EmptyState } from "@/ui/empty-state";
import { categoryLabel, debtTypeLabel, orderedCategories, subTypeLabel } from "@/accounts/labels";

export default function Accounts() {
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

  const groups = data
    ? orderedCategories(data.assets.map((a) => a.category)).map((category) => ({
        category,
        rows: data.assets.filter((a) => a.category === category),
      }))
    : [];

  return (
    <ScrollView
      className="flex-1 bg-paper px-4"
      contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
    >
      <Text className="text-ink text-2xl font-semibold mb-4">Accounts</Text>

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
  );
}
