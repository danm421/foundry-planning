"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import DialogTabs, { type DialogTab } from "./dialog-tabs";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

type Size = "sm" | "md" | "lg" | "xl";

/** Maps the surface sizing flags to an inline height style. Driven by inline
 *  style (not a Tailwind class) so the fixedHeight case can't silently fall
 *  back to content-hugging if an arbitrary `h-[min(...)]` utility fails to get
 *  generated. `fixedHeight` pins the same cap as the default `max-h` so tabbed
 *  dialogs keep a stable size when switching tabs instead of shrinking. */
export function surfaceHeightStyle(opts: {
  contentFill?: boolean;
  fixedHeight?: boolean;
}): CSSProperties {
  if (opts.contentFill) return { height: "min(90vh, 940px)" };
  if (opts.fixedHeight) return { height: "min(80vh, 720px)" };
  return { maxHeight: "min(80vh, 720px)" };
}

interface ActionConfig {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** When set, the button submits the form with this id (HTML form attr).
   *  When unset, the button calls onClick directly. */
  form?: string;
}

interface DialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: Size;
  tabs?: DialogTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Rendered to the right of the tab strip — used by auto-save dialogs to
   *  show a "Saving…" indicator or inline error chip without restructuring
   *  the tabs row. */
  tabBarRight?: ReactNode;
  /** Drops the scroll body's top padding so a `sticky top-0` element rendered
   *  as the first child (e.g. an in-form tab strip) can pin flush against the
   *  header with content scrolling cleanly behind it. */
  bodyTopFlush?: boolean;
  /** Media/preview mode: gives the surface a real, tall height (instead of the
   *  default content-hugging `max-h` cap) and makes the body a flex column, so
   *  a single `flex-1` child (e.g. a PDF iframe) fills the dialog vertically
   *  instead of collapsing to its intrinsic height. */
  contentFill?: boolean;
  /** Pins the surface to a fixed height (the same cap as the default `max-h`)
   *  instead of hugging the active content. Use for tabbed dialogs so switching
   *  tabs never resizes the box — short tabs show empty space below, tall tabs
   *  scroll. Unlike `contentFill` this keeps the current size, it just stops the
   *  box from shrinking. */
  fixedHeight?: boolean;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;        // defaults to a Cancel button that closes the dialog
  destructiveAction?: ActionConfig;
  children: ReactNode;
}

const sizeClass: Record<Size, string> = {
  sm: "max-w-[480px]",
  md: "max-w-[640px]",
  lg: "max-w-[880px]",
  xl: "max-w-[1600px]",
};

export default function DialogShell({
  open,
  onOpenChange,
  title,
  size = "md",
  tabs,
  activeTab,
  onTabChange,
  tabBarRight,
  bodyTopFlush,
  contentFill,
  fixedHeight,
  primaryAction,
  secondaryAction,
  destructiveAction,
  children,
}: DialogShellProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Esc-to-close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Body scroll-lock (ref-counted so stacked dialogs don't leak the lock —
  // see use-body-scroll-lock.ts).
  useBodyScrollLock(open);

  // Focus management: remember the opener, focus the surface, trap Tab inside,
  // and restore focus to the opener on close (WCAG 2.1.2 No Keyboard Trap is
  // satisfied because Esc closes; 2.4.3 Focus Order via return-focus).
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    surfaceRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const surface = surfaceRef.current;
      if (!surface) return;
      const focusables = surface.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) {
        e.preventDefault();
        surface.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === surface)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    const surface = surfaceRef.current;
    surface?.addEventListener("keydown", onKeyDown);
    return () => {
      surface?.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const cancel = secondaryAction ?? { label: "Cancel", onClick: () => onOpenChange(false) };
  const showFooter = Boolean(primaryAction || secondaryAction || destructiveAction);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        data-testid="dialog-overlay"
        className="absolute inset-0 bg-paper/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={surfaceHeightStyle({ contentFill, fixedHeight })}
        className={`relative z-10 w-full ${sizeClass[size]} flex flex-col whitespace-normal rounded-[var(--radius)] bg-card border-2 border-ink-3 ring-1 ring-black/60 shadow-2xl outline-none`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between gap-3 px-6 pt-4 border-b border-hair ${
            bodyTopFlush ? "pb-2" : "pb-4"
          }`}
        >
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-card-hover"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {tabs && tabs.length > 0 && activeTab !== undefined && onTabChange && (
          <DialogTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={onTabChange}
            right={tabBarRight}
          />
        )}

        {/* Body */}
        <div
          className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-6 ${
            bodyTopFlush ? "pt-0" : "pt-6"
          } ${contentFill ? "flex flex-col" : ""}`}
        >
          {children}
        </div>

        {/* Footer */}
        {showFooter && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-hair">
            <div>
              {destructiveAction && (
                <FooterButton variant="destructive" action={destructiveAction} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <FooterButton variant="ghost" action={cancel} />
              {primaryAction && <FooterButton variant="primary" action={primaryAction} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FooterButton({
  variant,
  action,
}: {
  variant: "primary" | "ghost" | "destructive";
  action: ActionConfig;
}) {
  const base = "rounded-[var(--radius-sm)] px-4 h-9 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variantClass =
    variant === "primary"
      ? "bg-accent text-accent-on hover:bg-accent-ink"
      : variant === "destructive"
      ? "text-crit hover:bg-card-hover"
      : "text-ink-2 hover:text-ink hover:bg-card-hover border border-transparent hover:border-hair";
  const label = variant === "primary" && action.loading ? "Saving…" : action.label;
  return (
    <button
      type={action.form ? "submit" : "button"}
      form={action.form}
      onClick={action.form ? undefined : action.onClick}
      disabled={action.disabled || action.loading}
      className={`${base} ${variantClass}`}
    >
      {label}
    </button>
  );
}
