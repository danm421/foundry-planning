import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { PortalMeDTO, RecurringRowDTO, RecurringsDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchMe, fetchRecurrings } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { formatMonth } from "@/ui/date";
import { Tile } from "@/home/tiles";
import { ProgressBar } from "@/ui/progress-bar";
import { CategoryDot } from "@/ui/category-dot";
import { EmptyState } from "@/ui/empty-state";
import { sortRecurrings, dueLabel, cadenceLabel } from "@/recurrings/logic";

/** A recurrings-list row. `Row`'s label/sublabel/value/valueSub shape can't
 *  host the web's fixed-width leading status column (dueLabel, colored red
 *  when overdue) without stealing `sublabel`'s styling slot for something
 *  that isn't a sublabel — so this is built inline, mirroring how
 *  budget.tsx's GroupTile composes its own rows around the shared parts
 *  (CategoryDot, formatMoney) instead of forcing everything through `Row`. */
function RecurringRow({
  r, month, onPress,
}: {
  r: RecurringRowDTO;
  month: string;
  onPress: () => void;
}) {
  const overdue = r.state === "overdue";
  const paid = r.state === "paid";
  return (
    <Pressable onPress={onPress}>
      <View className="flex-row items-center py-3">
        <Text
          className={`w-14 text-xs ${overdue ? "text-crit" : "text-ink-3"}`}
          numberOfLines={1}
        >
          {dueLabel(r, month)}
        </Text>
        <View className="mr-3">
          <CategoryDot color={r.categoryColor} />
        </View>
        <View className="flex-1 pr-3">
          <Text className="text-ink" numberOfLines={1}>{r.name}</Text>
          <Text className="text-ink-4 text-xs mt-0.5" numberOfLines={1}>
            {cadenceLabel(r)} · {r.categoryName ?? "Uncategorized"}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-ink" numberOfLines={1}>
            {formatMoney(paid ? r.postedThisMonth : r.predicted)}
          </Text>
          {paid ? <Text className="text-ink-4 text-xs mt-0.5">✓ paid</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function Recurrings() {
  const api = useApi();
  const router = useRouter();

  // This screen is a Stack sibling of (tabs), outside the MeGate provider
  // that scopes `useMe()` to the tab bar's subtree — fetch editEnabled
  // directly rather than crashing on a missing context. Fails closed: no
  // "+ New recurring" affordance until this resolves true. Same pattern as
  // category/[id].tsx / recurring/[id].tsx.
  const [me, setMe] = useState<PortalMeDTO | null>(null);
  const [data, setData] = useState<RecurringsDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchRecurrings(api));
    } catch {
      setError(true);
    }
  }, [api]);

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
        // Edit affordance simply stays hidden; the rest of the screen still works.
      });
    return () => {
      live = false;
    };
  }, [api]);

  const editEnabled = me?.editEnabled === true;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const sorted = data ? sortRecurrings(data.recurrings) : [];
  const paidPct = data ? data.paidSoFar / (data.paidSoFar + data.leftToPay) || 0 : 0;

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
        <Text className="text-ink text-2xl font-semibold flex-1">Recurrings</Text>
        {editEnabled ? (
          <Pressable onPress={() => router.push("/recurring/new")} hitSlop={8}>
            <Text className="text-accent-ink">+ New recurring</Text>
          </Pressable>
        ) : null}
      </View>

      {data === null && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : data === null && error ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load your recurrings.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : data ? (
        <>
          {error ? (
            <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
          ) : null}

          <Tile title={formatMonth(data.month)}>
            <View className="flex-row justify-between">
              <View>
                <Text className="text-ink-4 text-xs">Paid so far</Text>
                <Text className="text-ink text-xl font-semibold mt-0.5">{formatMoney(data.paidSoFar)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-ink-4 text-xs">Left to pay</Text>
                <Text className="text-ink text-xl font-semibold mt-0.5">{formatMoney(data.leftToPay)}</Text>
              </View>
            </View>
            <View className="mt-3">
              <ProgressBar pct={paidPct} />
            </View>
          </Tile>

          {sorted.length === 0 ? (
            <EmptyState title="No recurrings yet" hint='Use "+ New recurring" to track a bill.' />
          ) : (
            <Tile title="This month">
              {sorted.map((r) => (
                <RecurringRow
                  key={r.id}
                  r={r}
                  month={data.month}
                  onPress={() => router.push(`/recurring/${r.id}`)}
                />
              ))}
            </Tile>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
