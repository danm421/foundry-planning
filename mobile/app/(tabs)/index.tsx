import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, Text, View } from "react-native";
import type { PortalDashboardDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchDashboard } from "@/api/portal";
import { useMe } from "@/auth/me-gate";
import {
  NetThisMonthTile,
  NetWorthTile,
  SpendingTile,
  ToReviewTile,
  TopCategoriesTile,
  UpcomingTile,
} from "@/home/tiles";

export default function Home() {
  const api = useApi();
  const me = useMe();
  const [data, setData] = useState<PortalDashboardDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchDashboard(api));
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
      <View className="flex-row items-center mb-6">
        {me.firm.logoUrl ? (
          <Image source={{ uri: me.firm.logoUrl }} style={{ height: 28, width: 120 }} resizeMode="contain" />
        ) : (
          <Text className="text-ink font-semibold text-lg">{me.firm.name}</Text>
        )}
      </View>
      <Text className="text-ink text-2xl font-semibold mb-4">
        Hi {me.client.displayName.split(" ")[0] || "there"}
      </Text>

      {data === null && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : data === null && error ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load your dashboard.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : data ? (
        <>
          {error ? (
            <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
          ) : null}
          <NetWorthTile d={data.netWorth} />
          <SpendingTile d={data.spending} />
          <ToReviewTile d={data.toReview} />
          <NetThisMonthTile d={data.netThisMonth} />
          <TopCategoriesTile d={data.topCategories} />
          <UpcomingTile d={data.recurrings} />
        </>
      ) : null}
    </ScrollView>
  );
}
