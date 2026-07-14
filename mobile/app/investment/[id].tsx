// mobile/app/investment/[id].tsx
//
// Investment account detail modal: value + trend + sparkline, allocation
// breakdown, and a holdings list overlaid with live quotes. Quotes are
// fetched fire-and-forget and fail-soft — if the quote request errors, the
// modal still renders every holding at its static (as-of-last-sync) price.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { LiveQuote, PortalInvestmentsData } from "@contracts";
import { useApi } from "@/api/context";
import { fetchInvestments, fetchQuotes } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { EmptyState } from "@/ui/empty-state";
import { Sparkline } from "@/home/sparkline";
import { AllocationBars } from "@/invest/allocation-bars";
import { TrendBadge } from "@/invest/trend-badge";
import { pctChange } from "@/invest/trend";
import { withLiveQuotes, type HoldingWithQuote } from "@/invest/quotes";

/** Trims a shares count to at most 4 decimals without trailing zeros, e.g.
 *  `12.5`, `100`, `0.3333`. */
function formatShares(n: number): string {
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function HoldingRow({ holding }: { holding: HoldingWithQuote }) {
  const displayPrice = holding.livePrice ?? holding.price;
  return (
    <View className="flex-row items-center py-3">
      <View className="flex-1 pr-3">
        <Text className="text-ink" numberOfLines={1}>
          {holding.ticker ?? "—"} <Text className="text-ink-3">{holding.name}</Text>
        </Text>
        <Text className="text-ink-4 text-xs mt-0.5">
          {formatShares(holding.shares)} sh × {formatMoney(displayPrice, { cents: true })}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-ink" numberOfLines={1}>{formatMoney(holding.marketValue)}</Text>
        <TrendBadge pct={holding.changePct} />
      </View>
    </View>
  );
}

export default function InvestmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
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

  const account = data?.accounts.find((a) => a.id === id) ?? null;

  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  useEffect(() => {
    if (!account) return;
    let live = true;
    fetchQuotes(api, account.holdings.map((h) => h.ticker))
      .then((q) => {
        if (live) setQuotes(q);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, account]);

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

            {account ? (
              <>
                <Text className="text-ink text-xl font-semibold">
                  {account.name}
                  {account.last4 ? <Text className="text-ink-3 text-sm"> ···{account.last4}</Text> : null}
                </Text>
                <View className="flex-row justify-between items-baseline mt-2">
                  <Text className="text-ink text-3xl font-semibold">{formatMoney(account.value)}</Text>
                  <TrendBadge pct={pctChange(account.series)} />
                </View>
                <Sparkline series={account.series} />

                {account.allocations.length > 0 ? (
                  <View className="mt-6">
                    <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Allocation</Text>
                    <AllocationBars items={account.allocations} />
                  </View>
                ) : null}

                <View className="mt-6">
                  <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Holdings</Text>
                  {account.holdings.length === 0 ? (
                    <Text className="text-ink-4">No holdings for this account.</Text>
                  ) : (
                    withLiveQuotes(account.holdings, quotes).map((h, i) => (
                      <HoldingRow key={`${h.ticker ?? "none"}-${i}`} holding={h} />
                    ))
                  )}
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
