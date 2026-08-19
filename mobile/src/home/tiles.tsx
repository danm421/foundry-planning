import { Text, View } from "react-native";
import type { PortalDashboardDTO, PortalGoalFunding } from "@contracts";
import { formatMoney } from "@/ui/money";
import { goalGapLabel, goalTone, goalYearRange } from "@/goals/funding";
import { assetGroupWeights } from "./asset-groups";
import { AllocationBars } from "@/invest/allocation-bars";
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
  // The web tile breaks the asset side down by account type (a pie); bars are
  // the phone's idiom for the same shares, and reuse what Investments already
  // renders an allocation with.
  const byType = assetGroupWeights(d.assetGroups);
  return (
    <Tile title="Net worth">
      <Text className="text-ink text-3xl font-semibold">{formatMoney(d.netWorth)}</Text>
      <Sparkline series={d.series} />
      <View className="flex-row justify-between mt-1">
        <Text className="text-ink-3">Assets {formatMoney(d.assets)}</Text>
        <Text className="text-ink-3">Debt {formatMoney(d.debt)}</Text>
      </View>
      {byType.length > 0 ? (
        <View className="mt-4 border-t border-hair pt-3">
          <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">By type</Text>
          <AllocationBars items={byType} />
        </View>
      ) : null}
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

const GOAL_TONE_TEXT = { good: "text-good", warn: "text-warn", crit: "text-crit" } as const;
const GOAL_TONE_BAR = { good: "bg-good", warn: "bg-warn", crit: "bg-crit" } as const;

function GoalRow({ goal }: { goal: PortalGoalFunding }) {
  const tone = goalTone(goal.pctFunded);
  const years = goalYearRange(goal);
  return (
    <View className="mb-4">
      <View className="flex-row items-baseline justify-between mb-1">
        <Text className="text-ink-2 flex-1 mr-3" numberOfLines={1}>
          {goal.label}
          {goal.forName ? <Text className="text-ink-3"> · for {goal.forName}</Text> : null}
        </Text>
        <Text className={`text-sm font-semibold ${GOAL_TONE_TEXT[tone]}`}>
          {Math.round(goal.pctFunded * 100)}%
        </Text>
      </View>
      <View className="h-1.5 bg-card-2 rounded-full overflow-hidden">
        <View
          className={`h-1.5 ${GOAL_TONE_BAR[tone]}`}
          style={{ width: `${Math.max(0, Math.min(1, goal.pctFunded)) * 100}%` }}
        />
      </View>
      <View className="flex-row items-baseline justify-between mt-1">
        <Text className="text-ink-3 text-xs">{years ?? ""}</Text>
        <Text className="text-ink-3 text-xs">{goalGapLabel(goal)}</Text>
      </View>
    </View>
  );
}

/**
 * Percent funded per goal, straight off the cash-flow projection — the phone's
 * half of the web's TileGoalsFunded, which leads that dashboard beside net
 * worth.
 *
 * `projected` false and an empty `goals` are different answers and must read
 * differently: telling a household with a real plan that they have no goals is
 * a different lie from telling them it hasn't been projected yet.
 */
export function GoalsFundedTile({
  goals,
  projected,
}: {
  goals: PortalDashboardDTO["goals"];
  projected: boolean;
}) {
  return (
    <Tile title="Goals funded">
      {!projected ? (
        <Text className="text-ink-3">
          Your plan hasn't been projected yet — funding shows up here once your advisor
          builds it out.
        </Text>
      ) : goals.length === 0 ? (
        <Text className="text-ink-3">
          No goals on your plan yet. Your advisor adds them as you set them.
        </Text>
      ) : (
        <>
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} />
          ))}
          {/* Names the metric. The advisor side carries a different "funding"
              number (the solver's liquidity-boundary score), so this one has to
              say out loud which question it answers. */}
          <Text className="text-ink-3 text-xs border-t border-hair pt-3">
            The share of each goal's planned cost your projected cash flow covers.
          </Text>
        </>
      )}
    </Tile>
  );
}
