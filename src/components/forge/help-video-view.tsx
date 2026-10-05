// src/components/forge/help-video-view.tsx
"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DialogShell from "@/components/dialog-shell";
import type { HelpVideo } from "@/domain/forge/help/video-schema";
import { formatClock, posterSrc, recordedLabel, videoSrc } from "./help-video-format";

/** "**Open the Solver.** Then…" → bold runs as <strong>. Steps come from our
 *  own reviewed details files and render as text nodes (no HTML). */
function withBold(text: string) {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-ink">
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const HEADING = "mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3";

/** One Knowledge Hub video: the player (fits the panel; Expand for a large
 *  one), chapters to jump between, then the written steps. Videos are silent
 *  screen recordings, so the players are muted, which lets them autoplay. */
export function HelpVideoView({
  video,
  startAt,
  active,
  onBack,
}: {
  video: HelpVideo;
  startAt?: number;
  /** False while the Hub tab is hidden: pause, keep the position. */
  active: boolean;
  onBack: () => void;
}) {
  const inline = useRef<HTMLVideoElement>(null);
  const big = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [expandedFrom, setExpandedFrom] = useState<number | null>(null);
  // Read by the metadata handler, which can fire after the tab was hidden.
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
    if (!active) inline.current?.pause();
  }, [active]);

  const seekTo = (at: number, play = true) => {
    const el = inline.current;
    if (!el) return;
    el.currentTime = at;
    if (play) el.play().catch(() => {});
  };

  const expand = () => {
    const el = inline.current;
    setExpandedFrom(el?.currentTime ?? 0);
    el?.pause();
  };
  const collapse = useCallback(() => {
    // Before its metadata loads (or if it failed) the big player sits at 0;
    // copying that back would rewind the panel player.
    if (inline.current && big.current && big.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
      inline.current.currentTime = big.current.currentTime;
    }
    setExpandedFrom(null);
  }, []);

  // Esc closes only the large player. DialogShell and the Forge panel both
  // close on Escape at `window`; the event reaches `document` first, so
  // stopping it here keeps one press from also shutting the panel (the same
  // move as the panel's composer menu).
  const expanded = expandedFrom !== null;
  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      collapse();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, collapse]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-3">
      <button type="button" onClick={onBack} className="mb-2 self-start text-[12px] text-ink-3 hover:text-ink">
        ← All videos
      </button>
      <h3 className="text-[14px] font-semibold text-ink">{video.title}</h3>
      <p className="mb-2 text-[11px] text-ink-3">
        {recordedLabel(video.recordedOn)} · <span className="tabular">{formatClock(video.durationSec)}</span>
      </p>

      {failed ? (
        <p role="alert" className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-6 text-center text-[12px] text-ink-2">
          This video can&apos;t play right now.
        </p>
      ) : (
        <>
          <video
            ref={inline}
            src={videoSrc(video)}
            poster={posterSrc(video)}
            controls
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={() => {
              // 0 is a real chapter. Seek even in a hidden tab, but only play in a visible one.
              if (startAt !== undefined) seekTo(startAt, activeRef.current);
            }}
            onError={() => setFailed(true)}
            className="w-full rounded-[var(--radius-sm)] bg-card-2"
          />
          <button type="button" onClick={expand} className="mt-1 self-end text-[12px] font-medium text-secondary-ink hover:underline">
            Expand
          </button>
        </>
      )}

      <h4 className={HEADING}>Chapters</h4>
      <ol className="mt-1 space-y-0.5">
        {video.chapters.map((c) => (
          <li key={c.at}>
            <button
              type="button"
              disabled={failed}
              onClick={() => seekTo(c.at)}
              className="flex w-full gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left text-[12px] text-ink-2 hover:bg-card-hover disabled:opacity-50"
            >
              <span className="tabular w-9 flex-none text-ink-3">{formatClock(c.at)}</span>
              <span>{c.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <h4 className={HEADING}>Steps</h4>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-ink-2">
        {video.steps.map((s, i) => (
          <li key={i}>{withBold(s)}</li>
        ))}
      </ol>

      {video.goodToKnow && video.goodToKnow.length > 0 && (
        <>
          <h4 className={HEADING}>Good to know</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-ink-2">
            {video.goodToKnow.map((s, i) => (
              <li key={i}>{withBold(s)}</li>
            ))}
          </ul>
        </>
      )}

      {/* Portaled to <body>: the Forge panel is transformed, which would make it
          the containing block for the dialog's `fixed inset-0` and trap the
          "large" player inside the 420px panel. Only exists once Expand is
          clicked, so it never renders on the server. contentFill gives the
          dialog a real height and a flex-column body, so the player fits with
          its controls in view. */}
      {expandedFrom !== null &&
        createPortal(
          <DialogShell open onOpenChange={(o) => !o && collapse()} title={video.title} size="xl" contentFill>
            <video
              ref={big}
              src={videoSrc(video)}
              controls
              muted
              playsInline
              autoPlay
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = expandedFrom;
              }}
              className="min-h-0 w-full flex-1 object-contain"
            />
          </DialogShell>,
          document.body,
        )}
    </div>
  );
}
