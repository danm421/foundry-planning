// src/components/forge/help-video-links.tsx
"use client";

import type { VideoLink } from "./use-forge-stream";
import { formatClock } from "./help-video-format";

/** ▶ Watch cards a chat answer carries (from suggest_help_video). Clicking one
 *  switches to the Knowledge Hub tab and opens the video at the chapter. */
export function HelpVideoLinks({ links, onOpen }: { links: VideoLink[]; onOpen: (slug: string, at?: number) => void }) {
  return (
    <div className="mt-1.5 flex max-w-[90%] flex-col gap-1.5" data-testid="video-links">
      {links.map((l) => (
        <button
          key={l.slug}
          type="button"
          onClick={() => onOpen(l.slug, l.chapterAt)}
          className="flex items-start gap-2 rounded-[var(--radius)] border border-secondary/40 bg-secondary/10 px-3 py-2 text-left transition-colors hover:bg-secondary/20"
        >
          <span aria-hidden className="text-secondary-ink">
            ▶
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-secondary-ink">Watch: {l.title}</span>
            {l.chapterAt != null && l.chapterLabel && (
              <span className="block text-[11px] text-ink-3">
                <span className="tabular">{formatClock(l.chapterAt)}</span> · {l.chapterLabel}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
