// src/components/forge/detect-transcript.ts
//
// Heuristic: a paste is a candidate meeting transcript when it is long AND
// matches at least one structural signal (speaker labels, timestamps, or VTT/SRT
// markers). Tuned to avoid firing on pasted emails/articles. False negatives are
// acceptable — the advisor can use the explicit "Transcript" affordance.

const MIN_CHARS = 1_000;

export function looksLikeTranscript(text: string): { isCandidate: boolean; wordCount: number } {
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  // Signal 3: explicit transcript container markers — strong enough to skip the
  // length gate (WEBVTT/SRT are unambiguous file-format identifiers).
  const hasVtt = /\bWEBVTT\b/.test(text) || /-->/.test(text);
  if (hasVtt) return { isCandidate: true, wordCount };

  if (text.length < MIN_CHARS) return { isCandidate: false, wordCount };

  const lines = text.split(/\r?\n/);

  // Signal 1: ≥3 speaker-label lines like "Name: ..." (short label, then colon).
  const speakerLines = lines.filter((l) => /^\s*[A-Z][\w .'-]{1,40}:\s/.test(l)).length;

  // Signal 2: ≥2 timestamps (12:34, 1:02:03, or [00:00:00]).
  const timestamps = (text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? []).length;

  const isCandidate = speakerLines >= 3 || timestamps >= 2;
  return { isCandidate, wordCount };
}
