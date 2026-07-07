"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement } from "react";

export interface PersonInfo {
  role: "primary" | "spouse";
  firstName: string;
  lastName: string;
  dateOfBirth: string | Date | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
}

// Avatar gradients — moved verbatim from the old client-header.tsx.
const GRADIENTS = [
  "from-cat-portfolio/40 to-cat-life/40",
  "from-cat-income/40 to-cat-portfolio/40",
  "from-cat-tax/40 to-cat-insurance/40",
  "from-cat-transactions/40 to-cat-income/40",
  "from-accent/40 to-cat-life/40",
  "from-cat-insurance/40 to-cat-transactions/40",
  "from-good/30 to-cat-portfolio/30",
  "from-cat-life/40 to-cat-tax/40",
] as const;

function hashIndex(id: string, mod: number): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 997;
  return sum % mod;
}

function ageFromDob(dob: string | Date): number {
  const d = typeof dob === "string" ? new Date(dob) : dob;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function formatDob(dob: string | Date): string {
  const d = typeof dob === "string" ? new Date(dob) : dob;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fullName(p: PersonInfo): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function householdTitle(people: PersonInfo[]): string {
  const [primary, spouse] = people;
  if (spouse) {
    const spouseLast = spouse.lastName || primary.lastName;
    return `${primary.firstName} & ${spouse.firstName} ${spouseLast}`;
  }
  return fullName(primary);
}

function householdAges(people: PersonInfo[]): string {
  const [primary, spouse] = people;
  const primaryAge = primary.dateOfBirth ? ageFromDob(primary.dateOfBirth) : null;
  const spouseAge = spouse?.dateOfBirth ? ageFromDob(spouse.dateOfBirth) : null;
  if (primaryAge !== null && spouseAge !== null) {
    return `Ages ${primaryAge} & ${spouseAge}`;
  }
  if (primaryAge !== null) return `Age ${primaryAge}`;
  return "";
}

function initialsOf(p: PersonInfo): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

function ContactRow({
  label,
  value,
  breakAll,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
}): ReactElement {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-4">{label}</dt>
      <dd className={breakAll ? "break-all" : undefined}>{value}</dd>
    </div>
  );
}

export default function ClientIdentityMenu({
  clientId,
  people,
}: {
  clientId: string;
  people: PersonInfo[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside-click and Escape — mirrors scenario-chip-row.tsx.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const primary = people[0];
  const gradient = GRADIENTS[hashIndex(clientId, GRADIENTS.length)];
  const title = householdTitle(people);
  const ages = householdAges(people);

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-md py-1 pr-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          data-testid="client-portrait"
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-[11px] font-semibold text-ink`}
        >
          {initialsOf(primary)}
        </span>
        <span
          title={title}
          className="min-w-0 line-clamp-2 text-[14px] font-semibold leading-tight tracking-tight text-ink"
        >
          {title}
        </span>
        {ages ? (
          <span className="shrink-0 whitespace-nowrap text-[12px] leading-none text-ink-3">
            · {ages}
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className={`shrink-0 text-[10px] text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Client details"
          className="absolute left-0 top-full z-40 mt-1.5 min-w-[260px] rounded-xl border-2 border-ink-4 bg-card p-3 shadow-lg"
        >
          {people.map((p, i) => (
            <div
              key={p.role}
              className={i > 0 ? "mt-3 border-t border-hair pt-3" : undefined}
            >
              <div className="text-[13px] font-semibold text-ink">{fullName(p)}</div>
              <dl className="mt-1 space-y-0.5 text-[12px] text-ink-3">
                {p.dateOfBirth ? (
                  <ContactRow
                    label="DOB"
                    value={`${formatDob(p.dateOfBirth)} · Age ${ageFromDob(p.dateOfBirth)}`}
                  />
                ) : null}
                {p.email ? <ContactRow label="Email" value={p.email} breakAll /> : null}
                {p.phone ? <ContactRow label="Phone" value={p.phone} /> : null}
                {p.mobile ? <ContactRow label="Mobile" value={p.mobile} /> : null}
              </dl>
            </div>
          ))}
          <div className="mt-3 flex flex-col gap-1.5 border-t border-hair pt-2">
            <Link
              href={`/clients/${clientId}/details`}
              onClick={() => setOpen(false)}
              className="text-[12px] font-medium text-accent hover:underline"
            >
              View full profile →
            </Link>
            <Link
              href={`/clients/${clientId}/activity`}
              onClick={() => setOpen(false)}
              className="text-[12px] font-medium text-accent hover:underline"
            >
              Activity log →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
