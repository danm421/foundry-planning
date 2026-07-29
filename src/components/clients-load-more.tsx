"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PAGE_SIZE } from "@/lib/crm/sort";

/**
 * Appends one more page by raising ?take. The caller renders this only when
 * the server confirmed more rows exist, so there is no "no more results"
 * state to handle here.
 */
export function ClientsLoadMore({ take }: { take: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onClick() {
    const params = new URLSearchParams(searchParams);
    params.set("take", String(take + PAGE_SIZE));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 text-[13px] font-semibold text-ink-2 transition-colors hover:border-hair-2 hover:bg-card-hover hover:text-ink"
      >
        Load more
      </button>
    </div>
  );
}
