// src/domain/forge/help/video-schema.ts
//
// One Knowledge Hub help video's details file
// (src/domain/forge/help/videos/<slug>.json). The zod schema is for the
// contract test and the kb-video publish review; the app never parses at
// runtime — the files are reviewed in git and typed through videos/index.ts.
import { z } from "zod";

/** Topic tags. One shared list so "expense" and "expenses" can't drift apart;
 *  adding a tag is a one-line change here. */
export const HELP_VIDEO_TAGS = [
  "expenses",
  "income",
  "cash-flow",
  "scenarios",
  "solver",
  "retirement",
  "monte-carlo",
  "taxes",
  "estate",
  "accounts",
  "reports",
  "imports",
  "households",
] as const;
export type HelpVideoTag = (typeof HELP_VIDEO_TAGS)[number];

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const helpVideoSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().min(1),
    summary: z.string().min(1).max(140),
    screens: z.array(z.object({ route: z.string().startsWith("/"), label: z.string().min(1) }).strict()).min(1),
    tags: z.array(z.enum(HELP_VIDEO_TAGS)).min(1),
    searchTerms: z.array(z.string().min(1)),
    chapters: z.array(z.object({ at: z.number().min(0), label: z.string().min(1) }).strict()).min(1),
    steps: z.array(z.string().min(1)).min(1),
    goodToKnow: z.array(z.string().min(1)).optional(),
    durationSec: z.number().positive(),
    recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    appCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    video: z.object({ path: z.string(), sha256, bytes: z.number().int().positive() }).strict(),
    poster: z.object({ path: z.string(), sha256 }).strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Optional chaining: zod can still run this after a field-level failure,
    // and a missing chapter list or video block must report, not throw.
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (!v.chapters?.length || !v.video?.sha256 || !v.poster?.sha256) return;
    if (v.chapters[0].at !== 0) issue(["chapters", 0, "at"], "first chapter must start at 0");
    v.chapters.forEach((c, i) => {
      if (i > 0 && c.at <= v.chapters[i - 1].at) issue(["chapters", i, "at"], "chapters must be strictly ascending");
      if (c.at >= v.durationSec) issue(["chapters", i, "at"], "chapter starts after the video ends");
    });
    if (v.video.path !== `knowledge-hub/${v.slug}/${v.video.sha256.slice(0, 12)}.mp4`) {
      issue(["video", "path"], "video.path must be knowledge-hub/<slug>/<sha12>.mp4");
    }
    if (v.poster.path !== `knowledge-hub/${v.slug}/${v.poster.sha256.slice(0, 12)}.jpg`) {
      issue(["poster", "path"], "poster.path must be knowledge-hub/<slug>/<sha12>.jpg");
    }
  });

export type HelpVideo = z.infer<typeof helpVideoSchema>;
