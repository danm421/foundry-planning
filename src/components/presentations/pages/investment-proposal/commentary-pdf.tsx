// The generated (and possibly advisor-edited) commentary. Markdown arrives from
// the model; react-pdf has no Markdown renderer, so paragraphs split on blank
// lines and inline emphasis markers are stripped rather than rendered — a page
// that prints a literal "**" reads as a bug to a client.
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { Frame, type SectionProps } from "./sections-overview-pdf";

const S = StyleSheet.create({
  para: { fontSize: 9.5, color: T.ink2, lineHeight: 1.5, marginBottom: 8 },
  empty: { fontSize: 9.5, color: T.ink3, fontStyle: "italic" },
});

const stripInlineMarkdown = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)[*_](\S.*?\S)[*_](\s|$)/g, "$1$2$3")
    .replace(/^#+\s*/gm, "");

export function CommentarySection({ data, frame, accent }: SectionProps) {
  const paragraphs = data.commentary
    .split(/\n{2,}/)
    .map((p) => stripInlineMarkdown(p.trim()))
    .filter((p) => p.length > 0);

  return (
    <Frame frame={frame}>
      <SectionHead title="Commentary" subtitle="What this means for you" accent={accent} />
      {paragraphs.length === 0 ? (
        <Text style={S.empty}>No commentary has been generated for this proposal yet.</Text>
      ) : (
        <View>
          {paragraphs.map((p, i) => (
            <Text key={`${i}-${p.slice(0, 12)}`} style={S.para}>
              {p}
            </Text>
          ))}
        </View>
      )}
    </Frame>
  );
}
