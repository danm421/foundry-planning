"use client";
import { useCallback } from "react";
import { useToast } from "@/components/toast";

/**
 * Shared vault write: JSON `fetch` + success/error toast + caller refresh.
 * Returns `true` only when the write landed, so callers can close their dialog
 * on success and keep it open (with the error toasted) on failure.
 */
export function useVaultMutate(onMutated: () => void) {
  const { showToast } = useToast();
  return useCallback(
    async (url: string, init: RequestInit, okMsg: string): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          ...init,
          headers: { "Content-Type": "application/json", ...init.headers },
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: unknown };
          throw new Error(typeof j.error === "string" ? j.error : `Request failed (${res.status})`);
        }
        showToast({ message: okMsg });
        onMutated();
        return true;
      } catch (err) {
        showToast({ message: err instanceof Error ? err.message : "Something went wrong" });
        return false;
      }
    },
    [showToast, onMutated],
  );
}
