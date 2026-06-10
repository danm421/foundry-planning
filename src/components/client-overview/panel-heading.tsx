import type { ReactElement, ReactNode } from "react";

interface PanelHeadingProps {
  /** A 16px icon element (Lucide-style, strokeWidth 1.5). */
  icon: ReactNode;
  /** Plain string or a linked title node. */
  title: ReactNode;
  /** Optional muted meta shown after the title (e.g. a year range or a count). */
  meta?: string;
}

/**
 * Warm, consistent overview panel header: a quiet icon chip beside the title.
 * Replaces the older "§.NN · TITLE" section markers — the legalistic eyebrow
 * just repeated the title and read cold on the first screen an advisor sees.
 */
export default function PanelHeading({ icon, title, meta }: PanelHeadingProps): ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hair bg-card-2 text-ink-3"
      >
        {icon}
      </span>
      <p className="text-[14px] font-semibold text-ink">
        {title}
        {meta ? (
          <span className="ml-1.5 font-mono text-[12px] font-normal tracking-tight text-ink-4">
            · {meta}
          </span>
        ) : null}
      </p>
    </div>
  );
}
