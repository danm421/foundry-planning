"use client";

import { useRef, useState } from "react";
import DialogShell, { surfaceHeightStyle } from "@/components/dialog-shell";
import { PlayIcon } from "@/components/icons";
import { formatClock, play, posterSrc, videoSrc } from "@/components/forge/help-video-format";
import type { HelpVideo } from "@/domain/forge/help/video-schema";
import { patchFirstRun } from "./first-run-card";

/** Sizes the 16:9 player so Dismiss stays in view on a short laptop screen:
 *  the dialog's height cap less ~230px of its header, intro and footer row. */
const PLAYER_MAX_WIDTH = `calc((${surfaceHeightStyle({}).maxHeight} - 230px) * 16 / 9)`;

/** Home's one-time welcome for a new advisor. Every way out — Dismiss, ×,
 *  Esc, a click outside — records it as seen, so it never comes back. */
export function WelcomeVideoDialog({ video }: { video: HelpVideo }) {
  const player = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(true);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!open) return null;

  // Optimistic, like the first-run card: a failed write only means the video
  // greets them once more on their next visit.
  function dismiss() {
    setOpen(false);
    void patchFirstRun("dismiss_welcome_video");
  }

  // No autoplay: a browser refuses sound on page load, and muted, the
  // narration is lost. This click is the gesture that lets it play with sound.
  // Focus moves to the player (its controls take over) as this button goes.
  function start() {
    const el = player.current;
    if (!el) return;
    play(el);
    el.focus();
  }

  return (
    <DialogShell open onOpenChange={(o) => !o && dismiss()} title="Welcome to Foundry" size="lg">
      <p className="text-[14px] leading-relaxed text-ink-2">
        Here&apos;s how to add your first household and start their plan
        <span className="text-ink-3">
          {" · "}
          <span className="tabular">{formatClock(video.durationSec)}</span>
        </span>
      </p>

      <div
        className="relative mx-auto mt-4 aspect-video w-full overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card-2"
        style={{ maxWidth: PLAYER_MAX_WIDTH }}
      >
        {failed ? (
          <p role="alert" className="flex h-full items-center justify-center px-6 text-center text-[13px] text-ink-2">
            This video can&apos;t play right now. You&apos;ll find it in the Knowledge Hub.
          </p>
        ) : (
          <>
            {/* tabIndex puts the player in DialogShell's Tab trap, which only
                cycles through elements it can tab to. */}
            <video
              ref={player}
              src={videoSrc(video)}
              poster={posterSrc(video)}
              controls={started}
              playsInline
              preload="none"
              tabIndex={0}
              onPlay={() => setStarted(true)}
              onError={() => setFailed(true)}
              className="h-full w-full object-contain"
            />
            {!started && (
              <button
                type="button"
                data-autofocus
                onClick={start}
                aria-label="Play video"
                className="group absolute inset-0 flex items-center justify-center focus-visible:outline-none"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-hair-2 bg-paper/85 text-ink transition-colors group-hover:border-accent group-hover:text-accent-ink group-focus-visible:ring-2 group-focus-visible:ring-accent/60">
                  <PlayIcon width={26} height={26} className="translate-x-0.5" aria-hidden="true" />
                </span>
              </button>
            )}
          </>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-[12px] text-ink-3">It stays in the Knowledge Hub if you want it again.</p>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-sm)] border border-hair-2 px-4 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Dismiss
        </button>
      </div>
    </DialogShell>
  );
}
