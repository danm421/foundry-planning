import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CategoryDetail, HistoryBar, PortalMeDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchCategoryDetail, fetchMe, setBudget } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { formatDay } from "@/ui/date";
import { Row } from "@/ui/row";
import { CategoryDot } from "@/ui/category-dot";

const HISTORY_HEIGHT = 64;

function heatClass(heat: HistoryBar["heat"]): string {
  if (heat === "good") return "bg-good";
  if (heat === "warn") return "bg-warn";
  if (heat === "crit") return "bg-crit";
  return "bg-card-2";
}

/** 24-month spend strip: plain View bars, height proportional to amount vs.
 *  the max in the window. Flat baseline bars when every month is $0 (avoids
 *  a 0/0 division turning every bar into NaN height). */
function HistoryStrip({ history }: { history: HistoryBar[] }) {
  const maxAmount = history.reduce((m, b) => Math.max(m, b.amount), 0);
  return (
    <View className="flex-row items-end gap-0.5" style={{ height: HISTORY_HEIGHT }}>
      {history.map((bar) => {
        // Clamp negative amounts (refunds/credits shouldn't invert the bar) —
        // mirrors the web BudgetHistoryChart's Math.max(0, b.amount).
        const amount = Math.max(0, bar.amount);
        const height =
          maxAmount > 0 ? Math.max(2, Math.min(HISTORY_HEIGHT, (amount / maxAmount) * HISTORY_HEIGHT)) : 3;
        return (
          <View key={bar.month} className="flex-1 justify-end">
            <View className={`${heatClass(bar.heat)} rounded-sm`} style={{ height }} />
          </View>
        );
      })}
    </View>
  );
}

export default function CategoryDetailModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();

  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // The modal is a Stack sibling of (tabs), outside the MeGate provider that
  // scopes `useMe()` to the tab bar's subtree — fetch editEnabled directly
  // rather than crashing on a missing context. Fails closed: no editor until
  // this resolves true.
  const [me, setMe] = useState<PortalMeDTO | null>(null);

  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      const d = await fetchCategoryDetail(api, id);
      setDetail(d);
      setBudgetInput(d.monthlyBudget != null ? String(d.monthlyBudget) : "");
    } catch {
      setError(true);
    }
  }, [api, id]);

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
        // Edit affordance simply stays hidden; the rest of the modal still works.
      });
    return () => {
      live = false;
    };
  }, [api]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function saveBudget(amount: number | null, failureMessage: string) {
    setSaveError(null);
    setSaving(true);
    try {
      await setBudget(api, id, amount);
      await load();
    } catch {
      setSaveError(failureMessage);
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    const parsed = Number(budgetInput);
    void saveBudget(parsed > 0 ? parsed : null, "Couldn't save that budget.");
  }

  function handleClear() {
    void saveBudget(null, "Couldn't clear that budget.");
  }

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
        {detail === null && !error ? (
          <View className="py-24 items-center">
            <ActivityIndicator />
          </View>
        ) : detail === null && error ? (
          <View className="py-24 items-center">
            <Text className="text-ink-2">Couldn't load this category.</Text>
            <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
          </View>
        ) : detail ? (
          <>
            {error ? (
              <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
            ) : null}

            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-full bg-card-2 items-center justify-center mr-3">
                <Text className="text-lg">{detail.emoji}</Text>
              </View>
              <View className="flex-1 flex-row items-center">
                <CategoryDot color={detail.color} />
                <Text className="text-ink text-xl font-semibold ml-2 flex-1" numberOfLines={1}>
                  {detail.name}
                </Text>
              </View>
            </View>

            <Text className="text-ink text-3xl font-semibold mt-4">{formatMoney(detail.spentThisMonth)}</Text>
            <Text className="text-ink-3">spent this month</Text>
            {detail.remainingThisMonth != null ? (
              <Text className={detail.remainingThisMonth >= 0 ? "text-good mt-1" : "text-crit mt-1"}>
                {detail.remainingThisMonth >= 0
                  ? `${formatMoney(detail.remainingThisMonth)} left`
                  : `${formatMoney(Math.abs(detail.remainingThisMonth))} over`}
              </Text>
            ) : null}

            {me?.editEnabled ? (
              <View className="mt-6 bg-card border border-hair rounded-2xl p-4">
                <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Monthly budget</Text>
                <View className="flex-row items-center">
                  <TextInput
                    className="flex-1 bg-card-2 text-ink border border-hair rounded-xl px-3 py-2 mr-2"
                    placeholder="0"
                    placeholderTextColor="#848a98"
                    keyboardType="decimal-pad"
                    value={budgetInput}
                    onChangeText={setBudgetInput}
                    editable={!saving}
                  />
                  <Pressable
                    className={`bg-accent rounded-xl px-4 py-2 mr-2 ${saving ? "opacity-50" : ""}`}
                    disabled={saving}
                    onPress={handleSave}
                  >
                    <Text className="text-paper font-semibold">Save</Text>
                  </Pressable>
                  <Pressable
                    className={`border border-hair rounded-xl px-4 py-2 ${saving ? "opacity-50" : ""}`}
                    disabled={saving}
                    onPress={handleClear}
                  >
                    <Text className="text-ink-2">Clear</Text>
                  </Pressable>
                </View>
                {saveError ? <Text className="text-crit mt-2">{saveError}</Text> : null}
              </View>
            ) : null}

            {detail.history.length > 0 ? (
              <View className="mt-6">
                <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">History</Text>
                <HistoryStrip history={detail.history} />
              </View>
            ) : null}

            {detail.metrics.length > 0 ? (
              <View className="mt-6">
                <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Key metrics</Text>
                {detail.metrics.map((m) => (
                  <Row
                    key={m.year}
                    label={String(m.year)}
                    value={formatMoney(m.total)}
                    valueSub={`${formatMoney(m.avgMonthly)} avg`}
                  />
                ))}
              </View>
            ) : null}

            <View className="mt-6">
              <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">
                Transactions ({detail.transactions.length})
              </Text>
              {detail.transactions.length === 0 ? (
                <Text className="text-ink-4">No transactions for this category yet.</Text>
              ) : (
                detail.transactions.map((t) => (
                  <Row
                    key={t.id}
                    label={t.merchantName ?? t.name}
                    sublabel={formatDay(t.date)}
                    value={formatMoney(t.amount, { cents: true })}
                  />
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
