"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Removes the `?plans=` query param from the URL once on mount. v4 stores
 * per-widget planIds; the page-level `?plans=` is only consumed by the v3→v4
 * migration's first read.
 */
export function useStripPlansUrl(): void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (!params.get("plans")) return;
    const next = new URLSearchParams(params);
    next.delete("plans");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
