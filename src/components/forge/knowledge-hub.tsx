// src/components/forge/knowledge-hub.tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { HELP_VIDEOS } from "@/domain/forge/help/videos";
import type { HelpVideo } from "@/domain/forge/help/video-schema";
import { searchHelpVideos, type HelpVideoHit } from "@/domain/forge/help/video-search";
import { useForge } from "./forge-provider";
import { matchesWalkthroughRoute } from "./walkthrough-route-match";
import { HelpVideoView } from "./help-video-view";
import { formatClock, posterSrc } from "./help-video-format";

/** An opened video. `n` keys the player so re-opening remounts and re-seeks. */
type Opened = { slug: string; at?: number; n: number };
type Item = Pick<HelpVideoHit, "video" | "chapter">;

/** The Forge's Knowledge Hub tab: search, videos for the current screen, then
 *  every video. A ▶ Watch card in Chat opens a video here via hubTarget. */
export function KnowledgeHub({
  active,
  videos = HELP_VIDEOS,
}: {
  /** False while the tab is hidden; an open video pauses. */
  active: boolean;
  videos?: readonly HelpVideo[];
}) {
  const { pathname, hubTarget, askInChat } = useForge();
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [seenTarget, setSeenTarget] = useState<number | null>(null);

  // Adopt each new Watch-card target once. Render-time adjustment (React's
  // pattern for state that follows a prop), not an effect.
  if (hubTarget && hubTarget.nonce !== seenTarget) {
    setSeenTarget(hubTarget.nonce);
    setOpened({ slug: hubTarget.slug, at: hubTarget.at, n: hubTarget.nonce });
  }

  const newestFirst = useMemo(
    () => [...videos].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn)),
    [videos],
  );
  const forScreen = useMemo(
    () => newestFirst.filter((v) => v.screens.some((s) => matchesWalkthroughRoute(s.route, pathname))),
    [newestFirst, pathname],
  );
  const hits = useMemo(() => (query.trim() ? searchHelpVideos(query, videos) : []), [query, videos]);

  const open = (slug: string, at?: number) => setOpened({ slug, at, n: Date.now() });
  const video = opened ? videos.find((v) => v.slug === opened.slug) : undefined;
  if (opened && video) {
    return <HelpVideoView key={opened.n} video={video} startAt={opened.at} active={active} onBack={() => setOpened(null)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-hair px-4 py-3">
        <input
          type="search"
          aria-label="Search help videos"
          placeholder="Search help videos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-hair-2 bg-card-2 px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-secondary focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {query.trim() ? (
          hits.length > 0 ? (
            <VideoList items={hits} onOpen={open} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-[13px] text-ink-2">No videos match.</p>
              <button
                type="button"
                onClick={() => askInChat(query.trim())}
                className="rounded-[var(--radius-sm)] border border-secondary/40 bg-secondary-wash px-2.5 py-1 text-[12px] font-medium text-secondary-ink hover:bg-secondary/20"
              >
                Ask in Chat instead
              </button>
            </div>
          )
        ) : (
          <>
            {forScreen.length > 0 && (
              <Section title="For this screen">
                <VideoList items={forScreen.map((v) => ({ video: v }))} onOpen={open} />
              </Section>
            )}
            <Section title="All videos">
              {newestFirst.length > 0 ? (
                <VideoList items={newestFirst.map((v) => ({ video: v }))} onOpen={open} />
              ) : (
                <p className="text-[12px] text-ink-3">No videos yet.</p>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function VideoList({ items, onOpen }: { items: Item[]; onOpen: (slug: string, at?: number) => void }) {
  return (
    <ul className="space-y-2">
      {items.map(({ video, chapter }) => (
        <li key={video.slug}>
          <button
            type="button"
            onClick={() => onOpen(video.slug, chapter?.at)}
            className="flex w-full gap-3 rounded-[var(--radius)] border border-hair p-2 text-left hover:bg-card-hover"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private, cookie-authed route; the image optimizer can't fetch it */}
            <img
              src={posterSrc(video)}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
              className="h-[54px] w-24 flex-none rounded-[var(--radius-sm)] bg-card-2 object-cover"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">{video.title}</span>
              <span className="block text-[12px] text-ink-3">{video.summary}</span>
              {chapter && (
                <span className="mt-0.5 block text-[11px] text-secondary-ink">
                  <span className="tabular">{formatClock(chapter.at)}</span> · {chapter.label}
                </span>
              )}
            </span>
            <span className="tabular flex-none text-[11px] text-ink-3">{formatClock(video.durationSec)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
