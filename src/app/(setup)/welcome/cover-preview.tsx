"use client";

import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { resolveAccentColor } from "@/components/pdf/theme";

/**
 * A live, scaled likeness of the report cover this advisor's clients will
 * receive — the thing every field on the setup step is buying them.
 *
 * It mirrors the real cover, `src/components/presentations/pages/cover/page-pdf.tsx`,
 * on the same 612×792 letter geometry: cream fill, a navy panel that widens
 * downward, three accent stripes parallel to its edge, an accent bar across the
 * foot, and — on the cream half — the logo (or the firm-name wordmark when
 * there is none) above the client name. That file's own comment is the promise
 * this preview has to keep: the navy is FIXED document chrome, and only the
 * accent and the logo are white-labelled.
 *
 * This is the advisor's document, not Foundry's. Its colours therefore come
 * from the report's own modules — never from the app's verdigris chrome.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const NAVY_TOP_X = 200;
const NAVY_BOT_X = 320;
const STRIPE_OFFSETS = [-12, -24, -36];
// Cream-panel flow, straight off the printed cover: logoBox marginTop 150,
// then the prepared-for block 130 below it. The logo box has a fixed height so
// the composition cannot shift when an image finishes loading.
const LOGO_TOP = 150;
const LOGO_H = 90;

// The cover's fixed document chrome: the navy panel, the white type on it, and
// the muted slate its small labels use. These are declared locally in
// page-pdf.tsx (re-exporting them would drag @react-pdf/renderer into this
// client bundle), so they are restated here rather than tokenised — they are
// print colours on a client-facing report, not app chrome.
// eslint-disable-next-line brand/no-raw-hex -- the report cover's fixed print chrome, mirrored from page-pdf.tsx
const CHROME = { navy: "#1b2a4a", white: "#ffffff", muted: "#8899b4" } as const;

// Everything else comes from the modules the shipped report actually reads, so
// the preview cannot drift from the PDF: cream paper from the deck theme, and
// the accent through the report's own resolver, which falls back honestly when
// the buyer has picked no colour yet.
const CREAM = PRESENTATION_THEME.paper;

/** A stand-in household, so the cream panel reads as a real cover. */
const SAMPLE_CLIENT = "Robert & Anne Whitfield";

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

/** Point sizes on the real 612pt-wide page, expressed against the preview's
 *  own width so type scales exactly as the printed cover does. */
function pt(size: number): string {
  return `${(size / PAGE_W) * 100}cqw`;
}

export function CoverPreview({
  firmName,
  logoUrl,
  primaryColor,
}: {
  firmName: string;
  logoUrl: string | null;
  primaryColor: string | null;
}) {
  const accent = resolveAccentColor(primaryColor);
  const name = firmName.trim();

  return (
    <div
      data-testid="cover-preview"
      className="relative w-full overflow-hidden rounded-sm"
      style={{
        aspectRatio: `${PAGE_W} / ${PAGE_H}`,
        containerType: "inline-size",
        backgroundColor: CREAM,
      }}
    >
      {/* Geometry, point-for-point with the printed cover. */}
      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
        preserveAspectRatio="none"
      >
        <rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill={CREAM} />
        <polygon
          points={`0,0 ${NAVY_TOP_X},0 ${NAVY_BOT_X},${PAGE_H} 0,${PAGE_H}`}
          fill={CHROME.navy}
        />
        {STRIPE_OFFSETS.map((off) => (
          <line
            key={off}
            x1={NAVY_TOP_X + off}
            y1={0}
            x2={NAVY_BOT_X + off}
            y2={PAGE_H}
            strokeWidth={2}
            stroke={accent}
          />
        ))}
        <rect x={0} y={PAGE_H - 5} width={PAGE_W} height={5} fill={accent} />
      </svg>

      {/* Navy panel — kicker, then who prepared it. */}
      <div
        className="absolute flex flex-col justify-center"
        style={{ left: pct(30, PAGE_W), width: pct(170, PAGE_W), top: 0, bottom: 0 }}
      >
        <div
          style={{
            width: pct(34, 170),
            height: pt(2),
            backgroundColor: accent,
            marginBottom: pt(12),
          }}
        />
        <p
          className="tabular uppercase"
          style={{ fontSize: pt(9), letterSpacing: "0.05em", color: CHROME.white, lineHeight: 1.45 }}
        >
          Financial Planning Report
        </p>
        <div style={{ height: pt(56) }} />
        <p
          className="tabular uppercase"
          style={{ fontSize: pt(7.5), letterSpacing: "0.18em", color: CHROME.muted, marginBottom: pt(3) }}
        >
          Prepared By
        </p>
        <p
          className="font-semibold"
          style={{ fontSize: pt(12), color: CHROME.white, lineHeight: 1.3 }}
        >
          {name || "Your firm"}
        </p>
        <div style={{ height: pt(18) }} />
        <p
          className="tabular uppercase"
          style={{ fontSize: pt(7.5), letterSpacing: "0.18em", color: CHROME.muted, marginBottom: pt(3) }}
        >
          Scenario
        </p>
        <p
          className="font-semibold"
          style={{ fontSize: pt(12), color: CHROME.white, lineHeight: 1.3 }}
        >
          Base case
        </p>
      </div>

      {/* Cream panel — the logo (or the wordmark) above the client name.
          Both blocks are positioned by `top`, never by a percentage margin: a
          percentage margin resolves against the containing block's WIDTH, which
          on this 612×792 box silently compresses the cover's vertical rhythm. */}
      <div
        className="absolute"
        style={{ left: pct(340, PAGE_W), right: pct(30, PAGE_W), top: 0, bottom: 0 }}
      >
        {/* Fixed-height box so the cover does not reflow when a logo loads. */}
        <div
          className="absolute flex w-full items-center justify-center"
          style={{ top: pct(LOGO_TOP, PAGE_H), height: pct(LOGO_H, PAGE_H) }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Your logo"
              className="max-h-full w-[95%] object-contain"
            />
          ) : (
            <p
              className="w-full text-center font-semibold"
              style={{ fontSize: pt(26), color: CHROME.navy, lineHeight: 1.15 }}
            >
              {name || "Your firm"}
            </p>
          )}
        </div>

        <div
          style={{ top: pct(LOGO_TOP + LOGO_H + 130, PAGE_H) }}
          className="absolute w-full text-center"
        >
          <p
            className="tabular uppercase"
            style={{ fontSize: pt(9), letterSpacing: "0.22em", color: CHROME.muted }}
          >
            Prepared For
          </p>
          <div
            className="mx-auto w-[95%]"
            style={{ height: pt(1), backgroundColor: accent, marginTop: pt(14), marginBottom: pt(14) }}
          />
          <p className="font-semibold" style={{ fontSize: pt(30), color: CHROME.navy }}>
            {SAMPLE_CLIENT}
          </p>
          <div
            className="mx-auto w-[95%]"
            style={{ height: pt(1), backgroundColor: accent, marginTop: pt(14) }}
          />
        </div>
      </div>

      <p
        className="tabular absolute uppercase"
        style={{
          left: pct(30, PAGE_W),
          bottom: pct(22, PAGE_H),
          fontSize: pt(7.5),
          letterSpacing: "0.22em",
          color: CHROME.muted,
        }}
      >
        Personal &amp; Confidential
      </p>
    </div>
  );
}
