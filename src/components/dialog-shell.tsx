"use client";

import { useEffect, useRef, type ReactNode } from "react";
import DialogTabs, { type DialogTab } from "./dialog-tabs";

type Size = "sm" | "md" | "lg" | "xl";

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

  // Body scroll-lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus the surface when opened (basic focus management; full focus trap not required for v1)
  useEffect(() => {
    if (open) surfaceRef.current?.focus();
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
        className={`relative z-10 w-full ${sizeClass[size]} max-h-[min(80vh,720px)] flex flex-col rounded-[var(--radius)] bg-card border border-hair-2 shadow-2xl outline-none`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-hair">
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
          <DialogTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

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
      ? "bg-accent text-accent-on hover:bg-accent-deep"
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
