import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

export function TileFrame({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="rounded-xl border border-hair bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <Link
          href={href}
          className="text-[11px] uppercase tracking-wide text-ink-3 hover:text-ink"
        >
          {linkLabel} →
        </Link>
      </div>
      {children}
    </section>
  );
}
