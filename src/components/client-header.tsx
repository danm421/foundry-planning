import type { ReactElement, ReactNode } from "react";

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

  return (
    <div className="flex items-center gap-4 px-[var(--pad-card)] py-6 border-b border-hair">
      <div
        data-testid="client-portrait"
        className={`flex h-[52px] w-[52px] items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-[18px] font-semibold text-ink`}
      >
        {initialsOf(client)}
      </div>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">
          {householdTitle(client)}
        </h1>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-3">
          <span>{ages}</span>
          <span>·</span>
          <span>Lead advisor: {advisorName}</span>
        </div>
      </div>
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
    </div>
  );
}
