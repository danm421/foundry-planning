import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { BudgetSummaryDTO, GroupCell } from "@contracts";
import { useApi } from "@/api/context";
import { fetchBudgetSummary } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { formatMonth } from "@/ui/date";
import { Tile } from "@/home/tiles";
import { Row } from "@/ui/row";
import { ProgressBar } from "@/ui/progress-bar";
import { CategoryDot } from "@/ui/category-dot";
import { EmptyState } from "@/ui/empty-state";

/** Group card: header row (dot + name + spent/budget) tappable to the
 *  group's own detail, a progress bar, then its leaf categories as Rows. */
function GroupTile({ group, onOpen }: { group: GroupCell; onOpen: (id: string) => void }) {
  const pct = group.budget != null && group.budget > 0 ? group.actual / group.budget : 0;
  const over = group.remaining != null && group.remaining < 0;

  return (
    <View className="bg-card border border-hair rounded-2xl p-4 mb-3">
      <Pressable onPress={() => onOpen(group.id)}>
        <View className="flex-row items-center">
          <CategoryDot color={group.color} size={12} />
          <Text className="text-ink font-semibold ml-2 flex-1" numberOfLines={1}>
            {group.name}
          </Text>
          <View className="items-end">
            <Text className="text-ink">{formatMoney(group.actual)}</Text>
            {group.budget != null ? (
              <Text className="text-ink-4 text-xs mt-0.5">of {formatMoney(group.budget)}</Text>
            ) : null}
          </View>
        </View>
        <View className="mt-3">
          <ProgressBar pct={pct} over={over} />
        </View>
      </Pressable>

      {group.leaves.length > 0 ? (
        <View className="mt-2">
          {group.leaves.map((leaf) => (
            <Row
              key={leaf.id}
              leading={<CategoryDot color={leaf.color} />}
              label={leaf.name}
              value={formatMoney(leaf.actual)}
              valueSub={leaf.budget != null ? `of ${formatMoney(leaf.budget)}` : null}
              onPress={() => onOpen(leaf.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function Budget() {
  const api = useApi();
  const router = useRouter();
  const [data, setData] = useState<BudgetSummaryDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchBudgetSummary(api));
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

  const openCategory = useCallback((id: string) => router.push(`/category/${id}`), [router]);

  const summaryPct = data && data.totalBudget > 0 ? data.totalSpent / data.totalBudget : 0;
  const summaryOver = data ? data.totalRemaining < 0 : false;

  return (
    <ScrollView
      className="flex-1 bg-paper px-4"
      contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
    >
      <Text className="text-ink text-2xl font-semibold mb-4">Budget</Text>

      {data === null && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : data === null && error ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load your budget.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : data ? (
        <>
          {error ? (
            <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
          ) : null}

          <Tile title={formatMonth(data.month)}>
            <View className="flex-row justify-between items-baseline">
              <Text className="text-ink text-3xl font-semibold">{formatMoney(data.totalSpent)}</Text>
              <Text className="text-ink-3">of {formatMoney(data.totalBudget)}</Text>
            </View>
            <View className="mt-3">
              <ProgressBar pct={summaryPct} over={summaryOver} />
            </View>
            <Text className={summaryOver ? "text-crit mt-2" : "text-ink-3 mt-2"}>
              {summaryOver
                ? `${formatMoney(Math.abs(data.totalRemaining))} over budget`
                : `${formatMoney(data.totalRemaining)} remaining`}
            </Text>
          </Tile>

          {data.groups.length === 0 ? (
            <EmptyState title="No budget categories yet" hint="Categories will show up here once set." />
          ) : (
            data.groups.map((group) => <GroupTile key={group.id} group={group} onOpen={openCategory} />)
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
