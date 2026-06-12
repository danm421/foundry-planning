"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { useToast } from "@/components/toast";
import { HOUSEHOLD_TRASH_RETENTION_DAYS } from "@/lib/crm/trash";

interface Props {
  householdId: string;
  householdName: string;
  /** True when the household is currently in the Trash. */
  deleted: boolean;
}

type Dialog = null | "soft" | "permanent";

const menuItem =
  "block w-full px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-card-2";

export function HouseholdTrashActions({ householdId, householdName, deleted }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu renders in a portal (fixed-positioned to the button) so the table
  // card's `overflow-hidden` can't clip it when this is the last row.
  const [menuPos, setMenuPos] = useState<
    { right: number; top: number } | { right: number; bottom: number } | null
  >(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    // The portaled menu is pinned to the button's viewport position, so close it
    // rather than let it drift when the page scrolls or resizes.
    function onReflow() {
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [menuOpen]);

  function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const gap = 6;
      // Estimated height only picks the open direction; the anchor (top/bottom) is exact.
      const estHeight = (deleted ? 2 : 1) * 38 + 8;
      const right = window.innerWidth - rect.right;
      const openUp = rect.bottom + gap + estHeight > window.innerHeight;
      setMenuPos(
        openUp
          ? { right, bottom: window.innerHeight - rect.top + gap }
          : { right, top: rect.bottom + gap },
      );
    }
    setMenuOpen(true);
  }

  async function call(url: string, method: "POST" | "DELETE"): Promise<boolean> {
    const res = await fetch(url, { method });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Request failed");
    }
    return true;
  }

  async function softDelete() {
    setBusy(true);
    try {
      await call(`/api/crm/households/${householdId}`, "DELETE");
      setDialog(null);
      showToast({
        message: `"${householdName}" moved to Trash.`,
        undo: { label: "Undo", onClick: () => restore() },
      });
      router.refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Delete failed." });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      await call(`/api/crm/households/${householdId}/restore`, "POST");
      showToast({ message: `"${householdName}" restored.` });
      router.refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Restore failed." });
    } finally {
      setBusy(false);
    }
  }

  async function purge() {
    setBusy(true);
    try {
      await call(`/api/crm/households/${householdId}/permanent`, "DELETE");
      setDialog(null);
      setConfirmName("");
      showToast({ message: `"${householdName}" permanently deleted.` });
      router.refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Permanent delete failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Household actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-card-2 hover:text-ink"
      >
        ⋯
      </button>

      {menuOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", ...menuPos }}
            className="z-50 min-w-[180px] overflow-hidden rounded-xl border border-hair bg-paper py-1 shadow-lg"
          >
            {deleted ? (
              <>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    void restore();
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={`${menuItem} text-red-400`}
                  onClick={() => {
                    setMenuOpen(false);
                    setDialog("permanent");
                  }}
                >
                  Delete permanently
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`${menuItem} text-red-400`}
                onClick={() => {
                  setMenuOpen(false);
                  setDialog("soft");
                }}
              >
                Delete
              </button>
            )}
          </div>,
          document.body,
        )}

      {dialog === "soft" && (
        <DialogShell
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title="Delete household"
          size="sm"
          destructiveAction={{
            label: "Move to Trash",
            onClick: () => void softDelete(),
            loading: busy,
          }}
        >
          <p className="text-[14px] text-ink-2">
            Move &ldquo;{householdName}&rdquo; to the Trash? It will be hidden from
            your client list but can be restored for up to{" "}
            {HOUSEHOLD_TRASH_RETENTION_DAYS} days.
          </p>
        </DialogShell>
      )}

      {dialog === "permanent" && (
        <DialogShell
          open
          onOpenChange={(o) => {
            if (!o) {
              setDialog(null);
              setConfirmName("");
            }
          }}
          title="Delete permanently"
          size="sm"
          destructiveAction={{
            label: "Delete permanently",
            onClick: () => void purge(),
            loading: busy,
            disabled: confirmName.trim() !== householdName,
          }}
        >
          <p className="text-[14px] text-ink-2">
            This permanently deletes &ldquo;{householdName}&rdquo; and all of its
            planning data. This cannot be undone. Type the household name to confirm.
          </p>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={householdName}
            className="mt-3 w-full rounded-md border border-hair bg-card px-3 py-2 text-[14px]"
          />
        </DialogShell>
      )}
    </div>
  );
}
