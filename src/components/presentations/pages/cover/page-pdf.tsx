import { Page, Text, View, Image, Svg, Polygon, Line, Rect, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

// Split-diagonal cover, ported from the eMoney report generator
// (ethos-transition-platform `_engine/_cover.py`): a deep-navy slanted panel on
// the left carries the report title + firm + date; a cream panel on the right
// carries the firm logo and the client name. White-label: the navy stays fixed
// as neutral document chrome, while the accent (diagonal stripes, rules) and the
// logo come from the firm's branding — falling back to the Foundry gold + the
// Foundry mark when a firm hasn't set their own.

const PAGE_W = 612;
const PAGE_H = 792;

// Navy/cream boundary x at top and bottom — the panel is narrower at the top.
const NAVY_TOP_X = 200;
const NAVY_BOT_X = 320;

const NAVY = "#1b2a4a";
const CREAM = PRESENTATION_THEME.paper; // ties the cover to the deck's interior pages
const WHITE = "#ffffff";
const MUTED = "#8899b4"; // labels on the navy panel

interface CoverProps {
  title?: string;
  firmName: string;
  firmTagline: string | null;
  clientName: string;
  spouseName: string | null;
  scenarioLabel: string;
  reportDate: string;
  /** Cream-panel logo as a base64 data URL — firm logo, or the Foundry default
   *  supplied by the export route. `null` falls back to the firm-name wordmark. */
  logoDataUrl: string | null;
  /** Diagonal stripes + rules; firm primaryColor or the report gold fallback. */
  accentColor: string;
}

const styles = StyleSheet.create({
  page: { position: "relative", fontFamily: "Inter" },

  // ── Navy panel (left) ──
  navyCol: { position: "absolute", top: 0, bottom: 0, left: 30, width: 170 },
  kicker: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 0.5,
    color: WHITE,
    textTransform: "uppercase",
    lineHeight: 1.45,
  },
  subtitle: { fontSize: 11, marginTop: 8, lineHeight: 1.4 },
  metaLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  metaValue: { fontSize: 12, fontWeight: 700, color: WHITE },
  metaValueMono: { fontFamily: "JetBrains Mono", fontSize: 11, color: WHITE },
  metaGroup: { marginBottom: 18 },
  confidential: {
    position: "absolute",
    left: 30,
    bottom: 22,
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    letterSpacing: 1.5,
    color: MUTED,
  },

  // ── Cream panel (right) ──
  creamCol: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 340,
    right: 30,
    alignItems: "center",
  },
  logoBox: { marginTop: 150, alignItems: "center" },
  logo: { width: 230, objectFit: "contain" },
  logoWordmark: { fontSize: 26, fontWeight: 700, color: NAVY, textAlign: "center" },
  preparedForBox: { marginTop: 130, alignItems: "center", width: "100%" },
  preparedForLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 2,
    color: MUTED,
    textTransform: "uppercase",
  },
  rule: { height: 1, width: 230, marginVertical: 14 },
  clientName: { fontWeight: 700, color: NAVY, textAlign: "center" },
});

function navyVertices(): string {
  return `0,0 ${NAVY_TOP_X},0 ${NAVY_BOT_X},${PAGE_H} 0,${PAGE_H}`;
}

// Crude single-line fit for the client name in the cream panel (~230pt wide).
function clientNameSize(name: string): number {
  if (name.length > 26) return 20;
  if (name.length > 18) return 24;
  return 30;
}

export function CoverPdf(props: CoverProps) {
  const names = props.spouseName
    ? `${props.clientName} & ${props.spouseName}`
    : props.clientName;
  const kicker = (props.title?.trim() || "Financial Planning Report").toUpperCase();
  const accent = props.accentColor;

  return (
    <Page size="LETTER" style={styles.page}>
      {/* Background: cream fill, navy slant, accent stripes + bottom bar */}
      <Svg style={{ position: "absolute", top: 0, left: 0 }} width={PAGE_W} height={PAGE_H}>
        <Rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill={CREAM} />
        <Polygon points={navyVertices()} fill={NAVY} />
        {[-12, -24, -36].map((off) => (
          <Line
            key={off}
            x1={NAVY_TOP_X + off}
            y1={0}
            x2={NAVY_BOT_X + off}
            y2={PAGE_H}
            strokeWidth={2}
            stroke={accent}
          />
        ))}
        <Rect x={0} y={PAGE_H - 5} width={PAGE_W} height={5} fill={accent} />
      </Svg>

      {/* Navy panel content */}
      <View style={styles.navyCol}>
        <View style={{ flex: 1 }} />
        <View style={{ width: 34, height: 2, backgroundColor: accent, marginBottom: 12 }} />
        <Text style={styles.kicker}>{kicker}</Text>
        {props.firmTagline ? (
          <Text style={{ ...styles.subtitle, color: accent }}>{props.firmTagline}</Text>
        ) : null}
        <View style={{ height: 56 }} />
        <View style={styles.metaGroup}>
          <Text style={styles.metaLabel}>Prepared By</Text>
          <Text style={styles.metaValue}>{props.firmName}</Text>
        </View>
        <View style={styles.metaGroup}>
          <Text style={styles.metaLabel}>Scenario</Text>
          <Text style={styles.metaValue}>{props.scenarioLabel}</Text>
        </View>
        <View style={styles.metaGroup}>
          <Text style={styles.metaLabel}>Date</Text>
          <Text style={styles.metaValueMono}>{props.reportDate}</Text>
        </View>
        <View style={{ flex: 1 }} />
      </View>
      <Text style={styles.confidential}>PERSONAL  &  CONFIDENTIAL</Text>

      {/* Cream panel content */}
      <View style={styles.creamCol}>
        <View style={styles.logoBox}>
          {props.logoDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={props.logoDataUrl} style={styles.logo} />
          ) : (
            <Text style={styles.logoWordmark}>{props.firmName}</Text>
          )}
        </View>
        <View style={styles.preparedForBox}>
          <Text style={styles.preparedForLabel}>Prepared For</Text>
          <View style={{ ...styles.rule, backgroundColor: accent }} />
          <Text style={{ ...styles.clientName, fontSize: clientNameSize(names) }}>{names}</Text>
          <View style={{ ...styles.rule, backgroundColor: accent }} />
        </View>
      </View>
    </Page>
  );
}
