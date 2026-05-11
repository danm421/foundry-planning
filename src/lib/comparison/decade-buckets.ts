import type { ProjectionYear } from "@/engine/types";

export interface DecadeBucket {
  decadeStart: number;
  years: ProjectionYear[];
}

export function bucketByDecade(years: ProjectionYear[]): DecadeBucket[] {
  const map = new Map<number, ProjectionYear[]>();
  for (const y of years) {
    const key = Math.floor(y.year / 10) * 10;
    const arr = map.get(key);
    if (arr) arr.push(y);
    else map.set(key, [y]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([decadeStart, ys]) => ({ decadeStart, years: ys }));
}
