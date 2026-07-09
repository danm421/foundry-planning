import { Text, View } from "react-native";
import type { PortalDashboardDTO } from "@contracts";
import { formatMoney } from "@/ui/money";
import { tokenToHex } from "@/ui/data-color";
import { Sparkline } from "./sparkline";

export function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="bg-card border border-hair rounded-2xl p-4 mb-3">
      <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">{title}</Text>
      {children}
    </View>
  );
}

export function NetWorthTile({ d }: { d: PortalDashboardDTO["netWorth"] }) {
  return (
    <Tile title="Net worth">
      <Text className="text-ink text-3xl font-semibold">{formatMoney(d.netWorth)}</Text>
      <Sparkline series={d.series} />
      <View className="flex-row justify-between mt-1">
        <Text className="text-ink-3">Assets {formatMoney(d.assets)}</Text>
        <Text className="text-ink-3">Debt {formatMoney(d.debt)}</Text>
      </View>
    </Tile>
  );
}

export function SpendingTile({ d }: { d: PortalDashboardDTO["spending"] }) {
  const pct = d.budgeted > 0 ? Math.min(1, d.spent / d.budgeted) : 0;
  return (
    <Tile title="Spending this month">
      <Text className="text-ink text-2xl font-semibold">
        {formatMoney(Math.max(0, d.left))} <Text className="text-ink-3 text-base">left</Text>
      </Text>
      <View className="h-2 bg-card-2 rounded-full mt-3 overflow-hidden">
        <View
          className={pct >= 1 ? "h-2 bg-crit rounded-full" : "h-2 bg-accent rounded-full"}
          style={{ width: `${pct * 100}%` }}
        />
      </View>
      <Text className="text-ink-3 mt-2">
        {formatMoney(d.spent)} of {formatMoney(d.budgeted)} budgeted
      </Text>
    </Tile>
  );
}

export function ToReviewTile({ d }: { d: PortalDashboardDTO["toReview"] }) {
  return (
    <Tile title="To review">
      <Text className="text-ink text-2xl font-semibold">
        {d.count} transaction{d.count === 1 ? "" : "s"}
      </Text>
      {d.sample.slice(0, 3).map((t) => (
        <View key={t.id} className="flex-row justify-between mt-2">
          <Text className="text-ink-2 flex-1 mr-2" numberOfLines={1}>
            {t.merchantName ?? t.name}
          </Text>
          <Text className="text-ink-3">{formatMoney(t.amount, { cents: true })}</Text>
        </View>
      ))}
      {d.count > 0 ? (
        <Text className="text-accent-ink mt-2">Review them in Transactions (next build)</Text>
      ) : null}
    </Tile>
  );
}

export function NetThisMonthTile({ d }: { d: PortalDashboardDTO["netThisMonth"] }) {
  const positive = d.net >= 0;
  return (
    <Tile title="Net this month">
      <Text className={positive ? "text-good text-2xl font-semibold" : "text-crit text-2xl font-semibold"}>
        {formatMoney(d.net)}
      </Text>
      <Text className="text-ink-3 mt-1">
        In {formatMoney(d.income)} · Out {formatMoney(d.spent)}
      </Text>
    </Tile>
  );
}

export function TopCategoriesTile({ d }: { d: PortalDashboardDTO["topCategories"] }) {
  if (d.length === 0) return null;
  return (
    <Tile title="Top categories">
      {d.map((c) => (
        <View key={c.id} className="flex-row items-center justify-between mt-2">
          <View className="flex-row items-center flex-1 mr-2">
            <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: tokenToHex(c.color) }} />
            <Text className="text-ink-2" numberOfLines={1}>
              {c.name}
            </Text>
          </View>
          <Text className="text-ink-3">{formatMoney(c.spent)}</Text>
        </View>
      ))}
    </Tile>
  );
}

export function UpcomingTile({ d }: { d: PortalDashboardDTO["recurrings"] }) {
  if (d.length === 0) return null;
  return (
    <Tile title="Next two weeks">
      {d.map((r) => (
        <View key={r.id} className="flex-row justify-between mt-2">
          <Text className="text-ink-2 flex-1 mr-2" numberOfLines={1}>
            {r.name}
          </Text>
          <Text className={r.state === "overdue" ? "text-crit" : "text-ink-3"}>
            {formatMoney(r.predicted)} · {r.daysUntil <= 0 ? "due" : `${r.daysUntil}d`}
          </Text>
        </View>
      ))}
    </Tile>
  );
}
