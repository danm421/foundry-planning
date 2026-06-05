"use client";

import type { ReactElement } from "react";
import { useBackNav } from "./back-nav-provider";
import { ChevronLeftIcon } from "./icons";

export default function BackButton(): ReactElement | null {
  const { target, targetLabel, goBack } = useBackNav();
  if (!target || !targetLabel) return null;

  return (
    <button
      type="button"
      onClick={goBack}
      title={`Back to ${targetLabel}`}
      className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-[13px] text-ink-3 hover:bg-card-2 hover:text-ink"
    >
      <ChevronLeftIcon width={16} height={16} />
      <span className="max-w-[160px] truncate">{targetLabel}</span>
    </button>
  );
}
