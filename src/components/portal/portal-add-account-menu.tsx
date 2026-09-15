"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { useDismissableMenu } from "@/lib/use-dismissable-menu";
import type { LinkScope } from "@/lib/portal/plaid-link-complete";

/**
 * Where each item lands. Every one navigates to the Accounts page carrying its
 * intent in `?add=`, and that page performs it: a successful Plaid link ends
 * in the account picker, which reconciles the new accounts against the
 * client's existing rows and refreshes the page's data. The client finishes on
 * Accounts either way, so the navigation has to happen regardless — the URL is
 * just carrying the intent across it.
 *
 * "Link Account" and "Link Liability" share an intent on purpose: Plaid runs
 * ONE link flow covering depository, credit and loan accounts and cannot know
 * which the client means until they choose inside it. Investments are a
 * genuinely separate flow (see `buildNewLinkProducts` in the link-token
 * route), so they get their own item.
 *
 * The intent values are `LinkScope` plus "manual", so the vocabulary the
 * Accounts page reads back is the same type this side writes.
 */
const ITEMS: readonly { label: string; intent: LinkScope | "manual" }[] = [
  { label: "Link Account", intent: "banking" },
  { label: "Link Investments", intent: "investments" },
  { label: "Link Liability", intent: "banking" },
  { label: "Add Manually", intent: "manual" },
];

/**
 * The rail's one write action, sitting above Dashboard: a labelled CTA that
 * opens a short menu of ways to add an account.
 */
export default function PortalAddAccountMenu({
  basePath = "/portal",
}: {
  basePath?: string;
}): ReactElement {
  const { open, setOpen, ref } = useDismissableMenu<HTMLDivElement>();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-accent-on transition-colors hover:bg-accent/90"
      >
        <PlusIcon width={14} height={14} aria-hidden />
        Add Account
        <ChevronDownIcon width={14} height={14} aria-hidden className="ml-auto" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-[var(--radius-sm)] border border-hair bg-paper p-1 shadow-lg"
        >
          {ITEMS.map((item) => (
            <Link
              key={item.label}
              role="menuitem"
              href={`${basePath}/organizer/accounts?add=${item.intent}`}
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-card-2 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
