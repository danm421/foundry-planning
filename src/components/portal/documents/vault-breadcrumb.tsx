"use client";
import type { ReactElement } from "react";
import { Fragment } from "react";
import { ChevronRightIcon } from "./vault-icons";

/**
 * Full ancestor breadcrumb. Every segment but the last is a button that
 * navigates to that folder; the last (current) segment is inert text. Scrolls
 * horizontally on narrow screens rather than wrapping so it never pushes the
 * page width.
 */
export function VaultBreadcrumb({
  trail,
  onNavigate,
}: {
  trail: { id: string | null; name: string }[];
  onNavigate: (folderId: string | null) => void;
}): ReactElement {
  return (
    <nav aria-label="Folder path" className="-mx-1 overflow-x-auto">
      <ol className="flex items-center gap-1 px-1 text-[13px] whitespace-nowrap">
        {trail.map((seg, i) => {
          const isLast = i === trail.length - 1;
          return (
            <Fragment key={seg.id ?? "root"}>
              {i > 0 && (
                <li aria-hidden="true" className="text-ink-4">
                  <ChevronRightIcon width={14} height={14} />
                </li>
              )}
              <li className="min-w-0">
                {isLast ? (
                  <span aria-current="page" className="truncate font-medium text-ink">
                    {seg.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate(seg.id)}
                    className="truncate rounded px-1 py-0.5 text-ink-3 hover:text-ink"
                  >
                    {seg.name}
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
