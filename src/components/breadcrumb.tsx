"use client";

import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

interface BreadcrumbProps {
  clientHouseholdTitle?: string;
}

export default function Breadcrumb({
  clientHouseholdTitle,
}: BreadcrumbProps): ReactElement {
  const pathname = usePathname();

  const crumbs: string[] = [];
  if (pathname.startsWith("/clients")) {
    crumbs.push("Clients");
    if (pathname.startsWith("/clients/") && clientHouseholdTitle) {
      crumbs.push(clientHouseholdTitle);
    }
  } else if (pathname.startsWith("/cma")) {
    crumbs.push("CMA's");
  }

  return (
    <div className="text-[13px] text-ink-3">
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span className="mx-2 text-ink-4">/</span> : null}
          <span className={i === crumbs.length - 1 ? "text-ink" : ""}>{c}</span>
        </span>
      ))}
    </div>
  );
}
