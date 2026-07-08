"use client";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { usePortalBasePath } from "@/components/portal/portal-detail-rail";

export function TileFrame({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  /** Path relative to the portal base (e.g. "/transactions"); the base differs
   *  between the client portal ("/portal") and the advisor preview. */
  href: string;
  linkLabel: string;
  children: ReactNode;
}): ReactElement {
  const base = usePortalBasePath();
  return (
    <section className="rounded-xl border border-hair bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <Link
          href={`${base}${href}`}
          className="text-[11px] uppercase tracking-wide text-ink-3 hover:text-ink"
        >
          {linkLabel} →
        </Link>
      </div>
      {children}
    </section>
  );
}
