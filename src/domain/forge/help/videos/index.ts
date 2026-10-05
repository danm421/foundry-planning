// src/domain/forge/help/videos/index.ts
//
// The Knowledge Hub's videos. One JSON details file per video sits beside this
// file; the kb-video skill's publish step writes it, and a person adds its
// import here. JSON imports widen literal unions (tags) to string, so each
// entry is cast — videos.contract.test.ts proves every file matches HelpVideo,
// which makes the cast checked rather than hopeful.
import type { HelpVideo } from "../video-schema";

export const HELP_VIDEOS: readonly HelpVideo[] = [];

export function getHelpVideo(slug: string): HelpVideo | undefined {
  return HELP_VIDEOS.find((v) => v.slug === slug);
}
