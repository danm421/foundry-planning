// src/components/forge/detect-transcript.ts
//
// Heuristic: a paste is a candidate meeting transcript when it is long AND
// matches at least one structural signal (speaker labels, timestamps, or VTT/SRT
// markers). Tuned to avoid firing on pasted emails/articles. False negatives are
// acceptable — the advisor can use the explicit "Transcript" affordance.

const MIN_CHARS = 1_000;

export function looksLikeTranscript(text: string): { isCandidate: boolean; wordCount: number } {
  const trimmed = text.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  // WEBVTT is an unambiguous file-format header — strong enough to bypass the
  // length gate. A bare "-->" arrow is weaker (it also appears in git diffs and
  // HTML comments), so it's length-gated below alongside the other signals.
  if (/\bWEBVTT\b/.test(text)) return { isCandidate: true, wordCount };

  if (text.length < MIN_CHARS) return { isCandidate: false, wordCount };

  const lines = text.split(/\r?\n/);

  // Signal 1: ≥3 speaker-label lines like "Name: ..." (short label, then colon).
  const speakerLines = lines.filter((l) => /^\s*[A-Z][\w .'-]{1,40}:\s/.test(l)).length;

  // Signal 2: ≥2 timestamps (12:34, 1:02:03, or [00:00:00]).
  const timestamps = (text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? []).length;

  // Signal 3: a VTT/SRT cue arrow (length-gated — weaker than the WEBVTT header).
  const hasVttArrow = /-->/.test(text);

  const isCandidate = speakerLines >= 3 || timestamps >= 2 || hasVttArrow;
  return { isCandidate, wordCount };
}
