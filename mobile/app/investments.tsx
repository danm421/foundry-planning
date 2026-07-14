import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { PortalInvestmentsData } from "@contracts";
import { useApi } from "@/api/context";
import { fetchInvestments } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { Tile } from "@/home/tiles";
import { Sparkline } from "@/home/sparkline";
import { Row } from "@/ui/row";
import { EmptyState } from "@/ui/empty-state";
import { AllocationBars } from "@/invest/allocation-bars";
import { TrendBadge } from "@/invest/trend-badge";
import { formatPct, pctChange } from "@/invest/trend";

export default function Investments() {
  const api = useApi();
  const router = useRouter();
  const [data, setData] = useState<PortalInvestmentsData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchInvestments(api));
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

  return (
    <ScrollView
      className="flex-1 bg-paper px-4"
      contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
    >
      <View className="flex-row items-center mb-4">
        <Pressable onPress={() => router.back()} hitSlop={8} className="mr-2 -ml-2 p-2">
          <Ionicons name="chevron-back" size={24} color="#f4f5f7" />
        </Pressable>
        <Text className="text-ink text-2xl font-semibold">Investments</Text>
      </View>

      {data === null && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : data === null && error ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load your investments.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : data ? (
        <>
          {error ? (
            <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
          ) : null}

          <Tile title="Total value">
            <View className="flex-row justify-between items-baseline">
              <Text className="text-ink text-3xl font-semibold">{formatMoney(data.totalValue)}</Text>
              <TrendBadge pct={pctChange(data.totalSeries)} />
            </View>
            <Sparkline series={data.totalSeries} />
          </Tile>

          {data.overallAllocations.length > 0 ? (
            <Tile title="Allocation">
              <AllocationBars items={data.overallAllocations} />
            </Tile>
          ) : null}

          {data.accounts.length === 0 ? (
            <EmptyState
              title="No investment accounts yet"
              hint="Link an investment account to see your holdings here."
            />
          ) : (
            <Tile title="Accounts">
              {data.accounts.map((a) => {
                const acctPct = pctChange(a.series);
                return (
                  <Row
                    key={a.id}
                    label={a.name}
                    sublabel={a.last4 ? `···${a.last4}` : a.category}
                    value={formatMoney(a.value)}
                    valueSub={acctPct !== null ? formatPct(acctPct) : null}
                    onPress={() => router.push(`/investment/${a.id}`)}
                  />
                );
              })}
            </Tile>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
