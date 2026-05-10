"use client";

import type { ReactElement, ReactNode } from "react";
import { useScrolledPast } from "@/hooks/use-scrolled-past";

interface ClientLike {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | string;
  spouseName: string | null;
  spouseLastName: string | null;
  spouseDob: Date | string | null;
}

interface ClientHeaderProps {
  client: ClientLike;
  advisorName: string;
  rightSlot?: ReactNode;
}

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

function ageFromDob(dob: Date | string): number {
  const d = typeof dob === "string" ? new Date(dob) : dob;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function initialsOf(c: ClientLike): string {
  return `${c.firstName[0] ?? ""}${c.lastName[0] ?? ""}`.toUpperCase();
}

function householdTitle(c: ClientLike): string {
  if (c.spouseName) {
    const spouseLast = c.spouseLastName ?? c.lastName;
    return `${c.firstName} & ${c.spouseName} ${spouseLast}`;
  }
  return `${c.firstName} ${c.lastName}`;
}

export default function ClientHeader({
  client,
  advisorName,
  rightSlot,
}: ClientHeaderProps): ReactElement {
  const gradient = GRADIENTS[hashIndex(client.id, GRADIENTS.length)];
  const clientAge = ageFromDob(client.dateOfBirth);
  const spouseAge = client.spouseDob ? ageFromDob(client.spouseDob) : null;
  const ages =
    spouseAge !== null ? `Ages ${clientAge} & ${spouseAge}` : `Age ${clientAge}`;
  const scrolled = useScrolledPast(40);

  return (
    <div
      className={`sticky top-14 z-30 flex items-center gap-3 px-[var(--pad-card)] border-b border-hair bg-paper transition-[height,padding] duration-200 ease-out ${
        scrolled ? "h-[44px]" : "h-[100px] gap-4"
      }`}
    >
      <div
        data-testid="client-portrait"
        className={`flex items-center justify-center rounded-full bg-gradient-to-br ${gradient} font-semibold text-ink shrink-0 transition-[height,width,font-size] duration-200 ease-out ${
          scrolled
            ? "h-7 w-7 text-[11px]"
            : "h-[52px] w-[52px] text-[18px]"
        }`}
      >
        {initialsOf(client)}
      </div>
      <div className="min-w-0 flex items-center gap-2 flex-wrap">
        <h1
          className={`font-semibold tracking-tight text-ink transition-[font-size] duration-200 ease-out ${
            scrolled ? "text-[14px] leading-none" : "text-[22px]"
          }`}
        >
          {householdTitle(client)}
        </h1>
        {scrolled ? (
          <span className="text-[12px] text-ink-3 leading-none">
            · {ages}
          </span>
        ) : (
          <div className="basis-full mt-1 flex items-center gap-2 text-[13px] text-ink-3">
            <span>{ages}</span>
            <span>·</span>
            <span>Lead advisor: {advisorName}</span>
          </div>
        )}
      </div>
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
    </div>
  );
}
