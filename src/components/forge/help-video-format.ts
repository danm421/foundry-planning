// src/components/forge/help-video-format.ts
//
// Display + URL helpers for Knowledge Hub videos.
import type { HelpVideo } from "@/domain/forge/help/video-schema";
import { assetVersion } from "@/domain/forge/help/asset-version";

/** 73.5 → "1:13" */
export function formatClock(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "2026-10-05" → "Recorded Oct 2026" */
export function recordedLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `Recorded ${d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/** ?v= is the content hash: a re-shot video gets a new URL, and the route
 *  refuses the old one rather than mixing two files' bytes. */
export const videoSrc = (v: HelpVideo) => `/api/knowledge-hub/videos/${v.slug}?v=${assetVersion(v.video)}`;
export const posterSrc = (v: HelpVideo) => `/api/knowledge-hub/videos/${v.slug}/poster?v=${assetVersion(v.poster)}`;

/** Plays with sound. A browser that refuses sound without a recent click
 *  (Safari) gets the video muted instead; the captions carry the narration. */
export function play(el: HTMLVideoElement) {
  el.play().catch((err: unknown) => {
    if (!(err instanceof DOMException) || err.name !== "NotAllowedError") return;
    el.muted = true;
    el.play().catch(() => {});
  });
}
