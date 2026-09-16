"use client";

import Link from "next/link";
import { PlusIcon } from "@/components/icons";
import { useDismissableMenu } from "@/lib/use-dismissable-menu";

/** Which edge a dropdown panel hangs from. */
export type MenuAlign = "left" | "right";

export type OverflowMenuItem = {
  label: string;
  disabled?: boolean;
  /** "destructive" = crit-colored (e.g. Unlink, Remove). Defaults to "default". */
  variant?: "default" | "destructive";
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: () => void });

const ITEM_CLASS: Record<"default" | "destructive", string> = {
  default:
    "block w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-card-2 hover:text-ink disabled:opacity-50",
  destructive:
    "block w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-crit transition-colors hover:bg-crit/10 disabled:opacity-50",
};

/**
 * Shared dropdown menu — a trigger plus a role="menu" panel, with click-outside
 * and Escape to close. Extracted from two near-identical copies (RelationshipCard
 * in crm-household-relationships-section.tsx and the family-card menu in
 * contacts-tab.tsx) so the interaction logic lives in one place. Each item is
 * either a Link (href) or a button (onClick).
 *
 * Two triggers, one menu. "kebab" is the ⋯ icon a table row wears; "cta" is the
 * compact accent pill the portal's "Add Account" menu wears, which shows
 * `triggerLabel` after a plus. They share the dropdown, the item markup and the
 * dismissal behaviour (`useDismissableMenu`) — only the trigger differs.
 */
export function OverflowMenu({
  triggerLabel,
  items,
  minWidthClassName = "min-w-[140px]",
  variant = "kebab",
  align = "right",
}: {
  /** The trigger's accessible name. A kebab carries it as an aria-label and
   *  callers vary it per-row ("Actions for {name}"); a CTA shows it. */
  triggerLabel: string;
  items: OverflowMenuItem[];
  /** Preserves each call site's original dropdown width. */
  minWidthClassName?: string;
  /** "kebab" = ⋯ icon (default). "cta" = accent pill showing `triggerLabel`. */
  variant?: "kebab" | "cta";
  /** Which edge the dropdown hangs from. A kebab sits at a row's right edge, so
   *  "right" stays the default; a CTA at the start of a column wants "left". */
  align?: MenuAlign;
}) {
  const { open, setOpen, ref: wrapperRef } = useDismissableMenu<HTMLDivElement>();

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      {variant === "cta" ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-fit items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on transition-colors hover:bg-accent/90"
        >
          <PlusIcon width={13} height={13} aria-hidden />
          {triggerLabel}
        </button>
      ) : (
        <button
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-card-2 hover:text-ink"
        >
          ⋯
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full z-30 mt-1.5 ${variant === "cta" ? "w-max " : ""}${minWidthClassName} rounded-[var(--radius-sm)] border border-hair bg-paper p-1 shadow-lg`}
        >
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={ITEM_CLASS[item.variant ?? "default"]}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className={ITEM_CLASS[item.variant ?? "default"]}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
