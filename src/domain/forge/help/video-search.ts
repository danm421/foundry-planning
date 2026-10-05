// src/domain/forge/help/video-search.ts
//
// Knowledge Hub search. Pure, so the Hub runs it in the browser on every
// keystroke and suggest_help_video runs the same ranking on the server.
// Words match by prefix ("expen" → "expense") with a light fold on both sides
// (plural -s, and -ing/-ed so "adding" and "added" find "add"); no typo
// tolerance in v1.
import type { HelpVideo } from "./video-schema";

export type HelpVideoHit = {
  video: HelpVideo;
  /** Meaningful query words found anywhere in the video's details. */
  matched: number;
  /** Meaningful words in the query. */
  of: number;
  score: number;
  /** Meaningful words whose best hit is the title, summary, search words or tags — what the video is ABOUT. */
  strongMatched: number;
  /** The chapter matching the most query words, when any matched. */
  chapter?: { at: number; label: string };
};

const STOPWORDS = new Set([
  "how", "do", "i", "to", "a", "an", "the", "my", "in", "on", "of", "for",
  "can", "what", "where", "is", "and", "or", "with", "it", "this", "that",
  "video", "videos", "watch", "show", "me", "about", "there", "are", "from",
]);

/** One fold per word. "saving" → "sav" still finds "save" by prefix. */
function fold(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** Each word folded AND as written: "saving" folds to "sav", and a half-typed
 *  "savin" is only a prefix of the word as written. */
const fieldWords = (text: string) => words(text).flatMap((w) => [w, fold(w)]);

function queryWords(query: string): string[] {
  return [...new Set(words(query).filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(fold))];
}

const FIELDS: { weight: number; strong: boolean; text: (v: HelpVideo) => string }[] = [
  { weight: 5, strong: true, text: (v) => v.title },
  { weight: 4, strong: true, text: (v) => `${v.summary} ${v.searchTerms.join(" ")}` },
  { weight: 3, strong: true, text: (v) => v.tags.join(" ") },
  { weight: 3, strong: false, text: (v) => v.screens.map((s) => s.label).join(" ") },
  { weight: 2, strong: false, text: (v) => v.chapters.map((c) => c.label).join(" ") },
  { weight: 1, strong: false, text: (v) => [...v.steps, ...(v.goodToKnow ?? [])].join(" ") },
];

const hits = (q: string, ws: string[]) => ws.some((w) => w.startsWith(q));

export function searchHelpVideos(query: string, videos: readonly HelpVideo[]): HelpVideoHit[] {
  const qs = queryWords(query);
  if (qs.length === 0) return [];
  const out: HelpVideoHit[] = [];
  for (const video of videos) {
    const fields = FIELDS.map((f) => ({ ...f, ws: fieldWords(f.text(video)) }));
    let matched = 0;
    let score = 0;
    let strongMatched = 0;
    for (const q of qs) {
      const best = fields.find((f) => hits(q, f.ws)); // FIELDS is ordered heaviest first
      if (!best) continue;
      matched += 1;
      score += best.weight;
      if (best.strong) strongMatched += 1; // strong fields are listed first, so a strong hit is always `best`
    }
    if (matched === 0) continue;
    let chapter: HelpVideoHit["chapter"];
    let chapterHits = 0;
    for (const c of video.chapters) {
      const n = qs.filter((q) => hits(q, fieldWords(c.label))).length;
      if (n > chapterHits) {
        chapterHits = n;
        chapter = { at: c.at, label: c.label };
      }
    }
    out.push({ video, matched, of: qs.length, score, strongMatched, ...(chapter ? { chapter } : {}) });
  }
  return out.sort(
    (a, b) => b.matched - a.matched || b.score - a.score || b.video.recordedOn.localeCompare(a.video.recordedOn),
  );
}

/** Good enough for chat to recommend: at least 60% of the question's words
 *  found in what the video is about (not just its steps or chapters). */
export function isStrongMatch(hit: HelpVideoHit): boolean {
  return hit.of > 0 && hit.strongMatched / hit.of >= 0.6;
}
