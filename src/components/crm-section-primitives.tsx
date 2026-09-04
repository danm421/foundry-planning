import type { ReactNode } from "react";

// Shared class strings + layout primitives for the CRM household detail
// surface. Everything here is token-bound, so the Industrial Dark theme
// (`:root[data-theme="industrial"]`) reskins all of it — radii included —
// without a single edit in this file.

/** Mono uppercase metadata — eyebrows, `dt` labels, counts, kind pills. */
export const monoLabelClass =
  "font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3";

/** Hairline pill — descriptive relationship/status/kind label. Accent is
 *  reserved for action + identity status, never for descriptive data. */
export const chipClass =
  "inline-flex items-center rounded-[var(--radius-sm)] border border-hair-2 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3";

/** Accent-bordered pill — identity roles (Primary, Spouse) and record status.
 *  The distinction from `chipClass` is load-bearing: accent means
 *  identity/action, never description. */
export const chipAccentClass =
  "inline-flex items-center rounded-[var(--radius-sm)] border border-accent-deep px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-accent";

/** Standard bordered information panel. */
export const panelClass =
  "rounded-[var(--radius)] border border-hair-2 bg-card";

/** Ghost button — transparent, hairline, ink text. */
export const addGhostClass =
  "rounded-[var(--radius-sm)] border border-hair-2 bg-transparent px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2 transition-colors duration-150 hover:border-hair-3 hover:bg-card-hover hover:text-ink";

/** Primary button — ivory fill, dark text (Industrial Dark inverts the usual
 *  accent-filled CTA; on dark/light themes this still resolves to the theme's
 *  own ink/paper pair). */
export const primaryButtonClass =
  "inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-on transition-colors duration-150 hover:bg-accent-ink";

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-hair-2 px-6 py-8 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{children}</p>
    </div>
  );
}

/**
 * The recurring `— CRM • HOUSEHOLD RECORD` motif: a short rule, then uppercase
 * mono segments separated by a middot. Replaces the old `sectionHeadingClass`
 * heading everywhere on this surface.
 *
 * `as` lets a section keep its semantic heading level — the label IS the
 * section's heading, so a bare `div` would strip the landmark.
 */
export function SectionLabel({
  segments,
  as: Tag = "h2",
  id,
  children,
}: {
  segments: string[];
  as?: "h1" | "h2" | "h3" | "div";
  /** Set when a `<section aria-labelledby>` points at this heading. */
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <Tag
        id={id}
        className="flex items-center gap-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-2"
      >
        <span aria-hidden="true" className="h-0.5 w-[22px] shrink-0 bg-ink-3" />
        {segments.map((s, i) => (
          <span key={s} className="flex items-center gap-2.5">
            {i > 0 && (
              <span aria-hidden="true" className="text-ink-4">
                •
              </span>
            )}
            {s}
          </span>
        ))}
      </Tag>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * Eyebrow + oversized display figure + a short supporting line, with an
 * optional 3px progress rule. Used by the Accounts net-worth header, the
 * Overview KPI band and the Activity cadence panel.
 *
 * `value` is rendered by the caller so money keeps going through `MoneyText` /
 * `.tabular` — this only owns the frame.
 */
export function MetricBlock({
  label,
  value,
  support,
  fillPct,
  size = "md",
}: {
  label: string;
  value: ReactNode;
  support?: ReactNode;
  /** 0–100. Omit for no rule. */
  fillPct?: number;
  size?: "sm" | "md" | "lg";
}) {
  // Metrics stay on the number mono (`.tabular`), not the display face: every
  // dollar, percent and count in this app is mono, and `.tabular` is unlayered
  // CSS that would win over a `font-display` utility anyway. The display face
  // is for words — page titles and section statements.
  const valueClass =
    size === "lg"
      ? "text-[40px] font-bold leading-[0.95] tracking-[-0.04em]"
      : size === "md"
        ? "text-[26px] font-bold leading-[1] tracking-[-0.03em]"
        : "text-[17px] font-bold leading-[1.1] tracking-[-0.02em]";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={monoLabelClass}>{label}</span>
      <span className={`tabular text-ink ${valueClass}`}>{value}</span>
      {support ? (
        <span className="font-mono text-[10.5px] tracking-[0.06em] text-ink-3">{support}</span>
      ) : null}
      {fillPct != null && (
        <span aria-hidden="true" className="mt-0.5 block h-[3px] w-full bg-hair">
          <span
            className="block h-full bg-ink-2"
            style={{ width: `${Math.max(0, Math.min(100, fillPct))}%` }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * The rules-based `dl` that replaced every ad-hoc definition grid on this
 * surface: a fixed label column, 1px row rules, last row unruled.
 */
export function DetailList({
  labelWidth = "120px",
  children,
}: {
  labelWidth?: string;
  children: ReactNode;
}) {
  return (
    <dl
      className="grid [&>*:nth-last-child(-n+2)]:border-b-0"
      style={{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr)` }}
    >
      {children}
    </dl>
  );
}

export function DetailRow({
  label,
  children,
  dense = false,
}: {
  label: string;
  children: ReactNode;
  dense?: boolean;
}) {
  const pad = dense ? "py-[7px]" : "py-3";
  return (
    <>
      <dt className={`${pad} border-b border-hair pr-3 ${monoLabelClass}`}>{label}</dt>
      <dd className={`${pad} min-w-0 border-b border-hair text-[13.5px] text-ink`}>{children}</dd>
    </>
  );
}

/** The em dash a missing value collapses to. */
export function Missing() {
  return <span className="text-ink-4">—</span>;
}

// Formatters shared by the Overview 360 band and the Accounts roll-up. Whole
// dollars only — this surface never shows cents.
const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function fmtMoney(raw: number | string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "—";
  return MONEY.format(n);
}

export function fmtPct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : String(Math.round(v));
}
