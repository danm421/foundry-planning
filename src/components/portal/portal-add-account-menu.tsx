"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { PlusIcon } from "@/components/icons";
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
 * There are only two link items because Plaid offers only two flows: ONE
 * covering depository, credit and loan accounts, and a separate one for
 * investments (see `buildNewLinkProducts` in the link-token route). The first
 * label names all three account types rather than saying "Account", because a
 * client adding a mortgage otherwise has no reason to think it belongs behind
 * a word that sounds like checking.
 *
 * The intent values are `LinkScope` plus "manual", so the vocabulary the
 * Accounts page reads back is the same type this side writes.
 */
const ITEMS: readonly { label: string; intent: LinkScope | "manual" }[] = [
  { label: "Link Bank, Card or Loan", intent: "banking" },
  { label: "Link Investments", intent: "investments" },
  { label: "Add Manually", intent: "manual" },
];

/**
 * The rail's one write action, sitting above Dashboard: a compact, centred CTA
 * that opens a short menu of ways to add an account. It hugs its label rather
 * than filling the rail so the rail reads as a list of destinations with one
 * button above it, not two competing full-width blocks.
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
        className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-on transition-colors hover:bg-accent/90"
      >
        <PlusIcon width={13} height={13} aria-hidden />
        Add Account
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-max min-w-[10rem] -translate-x-1/2 rounded-[var(--radius-sm)] border border-hair bg-paper p-1 shadow-lg"
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
