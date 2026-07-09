import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { PortalTransactionDTO } from "@contracts";
import { useApi } from "@/api/context";
import { useMe } from "@/auth/me-gate";
import { useTransactions, type CategoryPick, type TxnFilter } from "@/txn/use-transactions";
import { CategoryPickerModal } from "@/txn/category-picker";
import { formatMoney } from "@/ui/money";
import { formatDay } from "@/ui/date";
import { Row } from "@/ui/row";
import { CategoryDot } from "@/ui/category-dot";
import { EmptyState } from "@/ui/empty-state";

const WINDOWS = [
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "YTD", label: "YTD", days: 0 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: -1 },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];

/** UTC-pinned `from` date for a window. days<0 = All (no lower bound);
 *  days===0 = YTD (Jan 1 of the current UTC year). Mirrors the web
 *  TransactionsList's windowFrom, but explicitly UTC (toISOString /
 *  getUTCFullYear) instead of local-clock `Date.now()`. */
function windowFrom(days: number): string | undefined {
  if (days < 0) return undefined;
  const now = new Date();
  if (days === 0) return `${now.getUTCFullYear()}-01-01`;
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
}

type PickerTarget = { kind: "filter" } | { kind: "row"; id: string };

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={active ? "rounded-full bg-accent-wash px-3 py-1.5" : "rounded-full border border-hair px-3 py-1.5"}
    >
      <Text className={active ? "text-accent-ink text-xs font-medium" : "text-ink-3 text-xs"}>{label}</Text>
    </Pressable>
  );
}

/** Round review-check button: filled `text-good` check when reviewed,
 *  hollow ring otherwise. */
function ReviewButton({ reviewed, onPress }: { reviewed: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className={
        reviewed
          ? "w-6 h-6 rounded-full bg-good items-center justify-center ml-2"
          : "w-6 h-6 rounded-full border border-hair items-center justify-center ml-2"
      }
    >
      {reviewed ? <Text className="text-paper text-xs font-bold">{"✓"}</Text> : null}
    </Pressable>
  );
}

function accountSublabel(t: PortalTransactionDTO): string {
  const acct = t.accountName ? `${t.accountName}${t.accountMask ? ` ••${t.accountMask}` : ""}` : null;
  const day = formatDay(t.date);
  return acct ? `${acct} · ${day}` : day;
}

export default function Transactions() {
  const { accountId: accountIdParam } = useLocalSearchParams<{ accountId?: string }>();
  const api = useApi();
  const me = useMe();

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [windowKey, setWindowKey] = useState<WindowKey>("ALL");
  const [category, setCategory] = useState<CategoryPick>(null);
  const [accountId, setAccountId] = useState<string | undefined>(accountIdParam);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Debounce the search box ~300ms so every keystroke doesn't refetch.
  useEffect(() => {
    const id = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const days = WINDOWS.find((w) => w.key === windowKey)!.days;
  const filter: TxnFilter = useMemo(
    () => ({
      q: q || undefined,
      categoryId: category?.id,
      accountId,
      from: windowFrom(days),
      reviewed: unreviewedOnly ? false : undefined,
    }),
    [q, category, accountId, days, unreviewedOnly],
  );

  const {
    rows,
    hasMore,
    loading,
    loadingMore,
    error,
    mutationError,
    reset,
    loadMore,
    review,
    changeCategory,
    exclude,
    markAll,
  } = useTransactions(api, filter);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reset();
    setRefreshing(false);
  }, [reset]);

  const anyUnreviewed = rows.some((r) => !r.reviewed && !r.excluded && r.type !== "transfer");

  function openCategoryPicker(target: PickerTarget) {
    setPickerTarget(target);
    setPickerOpen(true);
  }

  function handlePick(cat: CategoryPick) {
    setPickerOpen(false);
    const target = pickerTarget;
    setPickerTarget(null);
    if (!target) return;
    if (target.kind === "filter") {
      setCategory(cat);
    } else {
      changeCategory(target.id, cat);
    }
  }

  function openRowActions(t: PortalTransactionDTO) {
    Alert.alert(t.merchantName ?? t.name, undefined, [
      { text: "Change category", onPress: () => openCategoryPicker({ kind: "row", id: t.id }) },
      { text: t.excluded ? "Include" : "Exclude", onPress: () => exclude(t.id, !t.excluded) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-paper px-4"
      contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
    >
      <Text className="text-ink text-2xl font-semibold mb-4">Transactions</Text>

      <TextInput
        value={qInput}
        onChangeText={setQInput}
        placeholder="Search merchant…"
        placeholderTextColor="#848a98"
        className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2 mb-3"
      />

      <View className="flex-row flex-wrap gap-2 mb-3">
        <Chip label="Unreviewed" active={unreviewedOnly} onPress={() => setUnreviewedOnly((v) => !v)} />
        {WINDOWS.map((w) => (
          <Chip key={w.key} label={w.label} active={windowKey === w.key} onPress={() => setWindowKey(w.key)} />
        ))}
        <Chip
          label={category ? `${category.name} ✕` : "Category"}
          active={!!category}
          onPress={() => (category ? setCategory(null) : openCategoryPicker({ kind: "filter" }))}
        />
        {accountId ? (
          <Chip
            label={`${rows.find((r) => r.accountId === accountId)?.accountName ?? "Account"} ✕`}
            active
            onPress={() => setAccountId(undefined)}
          />
        ) : null}
      </View>

      {error && rows.length > 0 ? (
        <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
      ) : null}
      {mutationError ? <Text className="text-warn mb-3">Couldn't save that change.</Text> : null}

      {me.editEnabled && anyUnreviewed ? (
        <Pressable className="bg-accent rounded-xl px-4 py-2.5 mb-3 self-start" onPress={markAll}>
          <Text className="text-paper font-semibold">Mark all reviewed</Text>
        </Pressable>
      ) : null}

      {loading && rows.length === 0 && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : error && rows.length === 0 ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load transactions.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : rows.length === 0 ? (
        <EmptyState title="No transactions" hint="Try widening your filters." />
      ) : (
        <>
          {rows.map((t) => (
            <View key={t.id} style={{ opacity: t.excluded ? 0.5 : 1 }}>
              <Row
                label={t.merchantName ?? t.name}
                sublabel={accountSublabel(t)}
                leading={<CategoryDot color={t.categoryColor} />}
                right={
                  <View className="flex-row items-center">
                    <View className="items-end">
                      <Text className={t.type === "income" ? "text-good" : "text-ink"} numberOfLines={1}>
                        {formatMoney(Number(t.amount), { cents: true })}
                      </Text>
                      {t.categoryName ? (
                        <Text className="text-ink-4 text-xs mt-0.5" numberOfLines={1}>
                          {t.categoryName}
                        </Text>
                      ) : null}
                    </View>
                    {me.editEnabled ? (
                      <>
                        <ReviewButton reviewed={t.reviewed} onPress={() => review(t.id, !t.reviewed)} />
                        <Pressable onPress={() => openRowActions(t)} hitSlop={8} className="ml-2 px-1">
                          <Text className="text-ink-3 text-base">{"⋯"}</Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                }
              />
            </View>
          ))}

          {hasMore ? (
            <Pressable
              className="border border-hair rounded-xl px-4 py-2.5 mt-2 items-center"
              onPress={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? <ActivityIndicator /> : <Text className="text-ink-2">Load more</Text>}
            </Pressable>
          ) : null}
        </>
      )}

      <CategoryPickerModal
        visible={pickerOpen}
        // Filter mode hides "Uncategorized": the server can't filter on
        // "categoryId is null", so picking it would just silently clear the
        // filter. Row mode keeps it — there null means "clear the category".
        allowUncategorized={pickerTarget?.kind === "row"}
        onClose={() => {
          setPickerOpen(false);
          setPickerTarget(null);
        }}
        onPick={handlePick}
      />
    </ScrollView>
  );
}
