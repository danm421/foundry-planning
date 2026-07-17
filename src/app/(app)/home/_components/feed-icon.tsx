import type { ReactElement, ReactNode } from "react";
import type { FeedItemKind } from "@/lib/home/types";

// Hand-rolled inline SVG in Lucide's idiom (24x24, outline, strokeWidth 1.5).
// The repo has no icon library — 76 components hand-roll inline SVG — and the
// brand's icon rule is outline-only, so we match the look without a dependency.
//
// Hue carries meaning: each feed kind is a distinct --data-* anchor. Never
// data-teal (#1f8a86 reads as accent #1f9e8c) and never accent itself.
const PATHS: Record<FeedItemKind, ReactNode> = {
  // check-square
  "task-due": (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </>
  ),
  // cake
  birthday: (
    <>
      <path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8" />
      <path d="M4 16s1.5-2 4-2 4 2 4 2 1.5-2 4-2 4 2 4 2" />
      <path d="M2 21h20" />
      <path d="M7 8v3M12 8v3M17 8v3" />
      <path d="M7 4h.01M12 4h.01M17 4h.01" />
    </>
  ),
  // flag
  milestone: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </>
  ),
  // at-sign
  mention: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
    </>
  ),
  // clipboard-check
  "intake-submitted": (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <path d="M9 14l2 2 4-4" />
    </>
  ),
  // download
  "import-committed": (
    <>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
};

// The only admissible hues: --data-* anchors, never data-teal (reads as accent)
// and never accent itself. A literal union makes the compiler enforce that,
// instead of leaving the rule to the comment above.
type DataHue =
  | "text-data-blue"
  | "text-data-pink"
  | "text-data-yellow"
  | "text-data-purple"
  | "text-data-green"
  | "text-data-grey"
  | "text-data-red";

const HUES: Record<FeedItemKind, DataHue> = {
  "task-due": "text-data-blue",
  birthday: "text-data-pink",
  milestone: "text-data-yellow",
  mention: "text-data-purple",
  "intake-submitted": "text-data-green",
  "import-committed": "text-data-grey",
};

export function FeedIcon({
  kind,
  overdue = false,
}: {
  kind: FeedItemKind;
  overdue?: boolean;
}): ReactElement {
  const hue: DataHue = overdue ? "text-data-red" : HUES[kind];
  return (
    <svg
      className={`h-4 w-4 shrink-0 ${hue}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[kind]}
    </svg>
  );
}
