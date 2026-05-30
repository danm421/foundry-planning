// Presentational headline component — renders a large serif heading made of
// coloured segments. Used by retirement analysis summary and probability views.

export interface HeadlineSegment {
  text: string;
  /** When true the segment renders in --color-accent. */
  accent?: boolean;
}

interface Props {
  segments: HeadlineSegment[];
  /** Heading level rendered for accessibility. Defaults to "h2". */
  level?: "h1" | "h2" | "h3";
}

export function AnalysisHeadline({ segments, level = "h2" }: Props) {
  const Tag = level;
  return (
    <Tag className="font-serif text-4xl leading-tight text-ink">
      {segments.map((seg, i) =>
        seg.accent ? (
          <span key={i} className="text-[color:var(--color-accent)]">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </Tag>
  );
}
