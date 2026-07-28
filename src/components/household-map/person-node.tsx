import type { MapPerson } from "@/lib/household-map/types";

/** Person glyph — same shape as `details-sidebar.tsx`'s ProfileIcon. */
function ProfileIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="7" r="3.2" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M3.5 19c.7-3.4 3-5.2 5.5-5.2s4.8 1.8 5.5 5.2" />
      <path d="M15 18.5c.4-2.5 2-3.6 3.5-3.6s3.1 1.1 3.5 3.6" />
    </svg>
  );
}

/** The avatar + name + age/retirement line that heads a board column. */
export default function PersonNode({ person }: { person: MapPerson }) {
  const line = [
    person.age != null ? `Age ${person.age}` : null,
    person.retirementYear != null ? `Retires ${person.retirementYear}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-hair-2 bg-card-2 text-ink-3">
        <ProfileIcon />
      </span>
      <span className="text-sm font-semibold text-ink">{person.firstName}</span>
      {line ? <span className="text-[11px] text-ink-3">{line}</span> : null}
    </div>
  );
}
