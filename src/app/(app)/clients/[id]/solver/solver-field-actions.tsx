"use client";

import type { ReactNode } from "react";

/**
 * The action line under a lever's value — its Solve control, then the
 * "Reset to <base>" hint.
 *
 * Both used to ride INLINE beside the value. Goals and Social Security lay
 * their fields out in a hard half-width grid (Tailwind's `grid-cols-2` is
 * `repeat(2, minmax(0, 1fr))`, so a column never grows past half the pane)
 * while the value itself is `shrink-0`. The extra inline width therefore
 * overflowed the column and painted over the neighbouring field — the Solve
 * button sat on top of Life Expectancy's minus step, and on the other spouse's
 * Social Security tile. Dropping to the next line makes each column's required
 * width the value's own, at every pane size.
 */
export function SolverFieldActions({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{children}</div>;
}
