import type { ReactElement } from "react";

/**
 * Initials disc for the Organizer → Household people cards.
 *
 * Deliberately monochrome (`card-2` fill, `ink-2` initials). The brand reserves
 * the accent for action, so an avatar — which is identity, not a control — never
 * carries it, and per-person hues would read as a data encoding that means
 * nothing here.
 */
export default function PersonAvatar({
  firstName,
  lastName,
  size = "md",
}: {
  firstName: string;
  lastName?: string | null;
  size?: "sm" | "md";
}): ReactElement {
  const initials =
    [firstName?.trim()[0], lastName?.trim()[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() || "?";

  const box = size === "md" ? "h-14 w-14 text-[18px]" : "h-11 w-11 text-[14px]";

  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-full border border-hair bg-card-2 font-medium tracking-wide text-ink-2`}
    >
      {initials}
    </span>
  );
}
