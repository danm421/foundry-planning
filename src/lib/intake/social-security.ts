/**
 * The Income step's Social Security answers, worded for reading back.
 *
 * Shared by the client's own review screen, the advisor's review diff and the
 * CRM note, so all three say the same thing about the same answer.
 */

import type { IntakeSocialSecurity } from "@/lib/intake/schema";
import { personLabel } from "@/lib/owner-labels";

type Answer = IntakeSocialSecurity["client"];

/**
 * "$2,800/mo at FRA · start at 67", or either half alone. Null when the person
 * answered nothing — a $0 benefit included, since that is what an untouched
 * field reads.
 */
export function socialSecurityAnswerLabel(a: Answer): string | null {
  const parts = [
    a?.piaMonthly
      ? `$${Math.round(a.piaMonthly).toLocaleString()}/mo at ${a.benefitAge ?? "FRA"}`
      : null,
    a?.claimingAge !== undefined ? `start at ${a.claimingAge}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const line = parts.join(" · ");
  return line[0].toUpperCase() + line.slice(1);
}

/**
 * One entry per person who answered, client first, named the way the step
 * named them. The co-client's answer is dropped when the form has no co-client
 * — the step never showed that row, so it is the residue of a draft whose
 * spouse was removed after the fact.
 */
export function answeredSocialSecurity(
  ss: IntakeSocialSecurity | undefined,
  family:
    | { primary?: { firstName?: string }; spouse?: { firstName?: string } | null }
    | undefined,
): { owner: "client" | "spouse"; name: string; label: string }[] {
  const names = {
    clientName: family?.primary?.firstName?.trim() || "Client",
    spouseName: family?.spouse?.firstName?.trim() || null,
  };
  const out: { owner: "client" | "spouse"; name: string; label: string }[] = [];
  for (const owner of ["client", "spouse"] as const) {
    if (owner === "spouse" && !family?.spouse) continue;
    const label = socialSecurityAnswerLabel(ss?.[owner]);
    if (label !== null) out.push({ owner, name: personLabel(owner, names), label });
  }
  return out;
}
