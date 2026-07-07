"use client";
// Shared plumbing for the #portal-detail drill-down rail. Every portal page
// that opens a detail panel (transactions, accounts, dashboard) portals it
// into the layout's `<aside id="portal-detail">` through this module.

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePortalMode } from "@/components/portal/portal-mode-context";

/**
 * Pages with two lists sharing the one rail (Accounts: assets + debts)
 * announce their opens on this window event so the other list can drop its
 * own selection instead of stacking a second panel.
 */
export const PORTAL_DETAIL_OPEN_EVENT = "foundry:portal-detail-open";

export function announceDetailOpen(source: string): void {
  window.dispatchEvent(new CustomEvent(PORTAL_DETAIL_OPEN_EVENT, { detail: { source } }));
}

export function useCloseOnOtherDetail(source: string, close: () => void): void {
  useEffect(() => {
    function onOpen(e: Event) {
      if ((e as CustomEvent<{ source: string }>).detail?.source !== source) close();
    }
    window.addEventListener(PORTAL_DETAIL_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PORTAL_DETAIL_OPEN_EVENT, onOpen);
  }, [source, close]);
}

/** Base path for cross-page links: the client portal or the advisor preview. */
export function usePortalBasePath(): string {
  const { mode, clientId } = usePortalMode();
  return mode === "advisor" ? `/clients/${clientId}/portal/preview` : "/portal";
}

/** Shared close affordance for rail panels. */
export function CloseButton({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <button type="button" onClick={onClose} className="text-[12px] text-ink-3 hover:text-ink">
      Close
    </button>
  );
}

/** dt/dd fact row for rail panels. */
export function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className="max-w-[60%] truncate text-right text-ink-2">{children}</dd>
    </div>
  );
}

/**
 * Mounts its children into `#portal-detail`: inline in the desktop rail, a
 * bottom sheet with a tap-to-dismiss scrim below `lg`. The target is resolved
 * AFTER commit — never during render, which breaks in the advisor preview
 * (see budget-view). Render conditionally: `{open && <PortalDetailPortal …>}`.
 */
export function PortalDetailPortal({
  closeLabel,
  onClose,
  children,
}: {
  /** aria-label for the mobile scrim button, e.g. "Close account details". */
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}): ReactElement | null {
  const [detailEl, setDetailEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailEl(document.getElementById("portal-detail"));
  }, []);
  if (!detailEl) return null;
  return createPortal(
    <div className="max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:flex max-lg:flex-col max-lg:justify-end">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 -z-10 bg-black/50 lg:hidden"
      />
      <div className="max-lg:max-h-[85vh] max-lg:overflow-y-auto">{children}</div>
    </div>,
    detailEl,
  );
}
