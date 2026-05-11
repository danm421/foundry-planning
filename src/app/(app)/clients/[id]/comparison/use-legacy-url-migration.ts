"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Rewrite legacy `?left=&right=` URLs to the canonical `?plans=` form on
 * mount. One-shot — when `?plans` is already present, this hook does nothing.
 */
export function useLegacyUrlMigration(): void {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    if (params.get("plans")) return;
    const left = params.get("left");
    const right = params.get("right");
    if (left === null && right === null) return;
    const np = new URLSearchParams(params);
    np.delete("left");
    np.delete("right");
    np.set("plans", `${left ?? "base"},${right ?? "base"}`);
    router.replace(`${pathname}?${np.toString()}`);
  }, [params, pathname, router]);
}
