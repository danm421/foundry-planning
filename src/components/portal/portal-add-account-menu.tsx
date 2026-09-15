"use client";

import type { ReactElement } from "react";
import {
  OverflowMenu,
  type MenuAlign,
  type OverflowMenuItem,
} from "@/components/overflow-menu";
import type { LinkScope } from "@/lib/portal/plaid-link-complete";

/** What the client picked. `LinkScope` plus "manual", so the vocabulary the
 *  Accounts page reads back is the same type this side writes. */
export type AddAccountIntent = LinkScope | "manual";

/**
 * The three ways into an account, in one place so the rail and the Accounts
 * page can never word them differently.
 *
 * There are only two LINK items because Plaid offers only two flows: ONE
 * covering depository, credit and loan accounts, and a separate one for
 * investments (see `buildNewLinkProducts` in the link-token route). The first
 * label names all three account types rather than saying "Account", because a
 * client adding a mortgage otherwise has no reason to think it belongs behind
 * a word that sounds like checking.
 */
const ITEMS: readonly { label: string; intent: AddAccountIntent }[] = [
  { label: "Link Bank, Card or Loan", intent: "banking" },
  { label: "Link Investments", intent: "investments" },
  { label: "Add Manually", intent: "manual" },
];

/**
 * Read an intent back off a URL, for the Accounts page performing what the rail
 * sent it. Derived from `ITEMS`, so a new menu item is understood on arrival
 * without a second list to remember — and anything else is rejected, because a
 * query param is user input.
 */
export function parseAddAccountIntent(raw: string | null): AddAccountIntent | null {
  return ITEMS.find((item) => item.intent === raw)?.intent ?? null;
}

type Props =
  /**
   * Rail binding. The rail can't run these flows — they live on the Accounts
   * page — so each item navigates there carrying its intent in `?add=`, and
   * that page performs it on arrival. The client finishes on Accounts either
   * way, so the navigation has to happen regardless; the URL is just carrying
   * the intent across it.
   */
  | { basePath?: string; onSelect?: undefined; disabled?: undefined; align?: MenuAlign }
  /**
   * Accounts-page binding. The flows are right here, so each item acts in
   * place and nothing navigates.
   */
  | {
      basePath?: undefined;
      onSelect: (intent: AddAccountIntent) => void;
      disabled?: boolean;
      align?: MenuAlign;
    };

/**
 * A compact accent CTA that opens a short menu of ways to add an account. It
 * hugs its label rather than filling its container so a rail reads as a list of
 * destinations with one button above it, not two competing full-width blocks.
 */
export default function PortalAddAccountMenu(props: Props): ReactElement {
  // Alignment belongs to wherever the menu is standing, not to the menu: the
  // rail's copy starts a left-aligned column, the Accounts header's sits at the
  // right end of a `justify-end` row where a left-hung panel would run off the
  // page.
  const align = props.align ?? "left";
  const items: OverflowMenuItem[] = ITEMS.map((item) =>
    props.onSelect
      ? {
          label: item.label,
          disabled: props.disabled,
          onClick: () => props.onSelect(item.intent),
        }
      : {
          label: item.label,
          href: `${props.basePath ?? "/portal"}/organizer/accounts?add=${item.intent}`,
        },
  );

  return (
    <OverflowMenu
      variant="cta"
      align={align}
      triggerLabel="Add Account"
      minWidthClassName="min-w-[10rem]"
      items={items}
    />
  );
}
