"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Removes `?plans=`, `?left=`, and `?right=` query params from the URL once
 * on mount. v4 stores per-widget planIds; these params are only consumed by
 * the v3→v4 migration's first read.
 */
export function useStripPlansUrl(): void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    const hasPlans = params.get("plans");
    const hasLeft = params.get("left");
    const hasRight = params.get("right");
    if (!hasPlans && !hasLeft && !hasRight) return;
    const next = new URLSearchParams(params);
    next.delete("plans");
    next.delete("left");
    next.delete("right");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
