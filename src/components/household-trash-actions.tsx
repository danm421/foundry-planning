"use client";

import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
        type="button"
        aria-label="Household actions"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-card-2 hover:text-ink"
      >
        ⋯
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-hair bg-paper py-1 shadow-lg">
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
        </div>
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
