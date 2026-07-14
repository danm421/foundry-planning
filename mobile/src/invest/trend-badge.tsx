// mobile/src/invest/trend-badge.tsx
//
// Shared by the Investments list (account row / total-value tile) and the
// investment detail modal (account header / per-holding change).

import { Text } from "react-native";
import { formatPct } from "./trend";

/** Arrow + signed percent, colored by direction. Hidden entirely when
 *  `pct` is null (fewer than 2 trend points, a zero baseline, or — for a
 *  per-holding badge — no live quote for that ticker). */
export function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <Text className={positive ? "text-good" : "text-crit"}>
      {positive ? "↗ " : "↘ "}
      {formatPct(pct)}
    </Text>
  );
}
