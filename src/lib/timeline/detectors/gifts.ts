import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent, TimelineEventDetail } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

function fmName(fm: { firstName: string; lastName: string | null }): string {
  return `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
}

export function detectGiftEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const trustEntityIds = new Set<string>();
  for (const e of data.entities ?? []) {
    if (e.trustSubType) trustEntityIds.add(e.id);
  }

  const familyMemberNameById = new Map<string, string>();
  for (const fm of data.familyMembers ?? []) familyMemberNameById.set(fm.id, fmName(fm));
  const externalNameById = new Map<string, string>();
  for (const x of data.externalBeneficiaries ?? []) externalNameById.set(x.id, x.name);

  const giftsByYear = new Map<number, NonNullable<ClientData["gifts"]>>();
  for (const g of data.gifts ?? []) {
    if (g.recipientEntityId && trustEntityIds.has(g.recipientEntityId)) continue;
    if (!inRange(g.year, projection)) continue;
    const list = giftsByYear.get(g.year) ?? [];
    list.push(g);
    giftsByYear.set(g.year, list);
  }

  for (const [year, gifts] of giftsByYear) {
    if (gifts.length === 0) continue;
    const total = gifts.reduce((acc, g) => acc + g.amount, 0);
    const recipientCount = new Set(
      gifts.map((g) => g.recipientFamilyMemberId ?? g.recipientExternalBeneficiaryId ?? g.recipientEntityId ?? "_unknown"),
    ).size;

    const details: TimelineEventDetail[] = gifts.map((g) => {
      const name =
        (g.recipientFamilyMemberId && familyMemberNameById.get(g.recipientFamilyMemberId)) ||
        (g.recipientExternalBeneficiaryId && externalNameById.get(g.recipientExternalBeneficiaryId)) ||
        "Recipient";
      const crummey = g.useCrummeyPowers ? " (Crummey)" : "";
      return { label: `${name} — ${g.grantor}`, value: `${currency(g.amount)}${crummey}` };
    });

    const crummeyCount = gifts.filter((g) => g.useCrummeyPowers).length;
    const outrightCount = gifts.length - crummeyCount;
    if (crummeyCount > 0 && outrightCount > 0) {
      details.push({
        label: "Crummey / outright",
        value: `${crummeyCount} Crummey · ${outrightCount} outright`,
      });
    }

    out.push({
      id: `estate:gifts:${year}`,
      year,
      category: "estate",
      subject: "joint",
      title: "Annual gifts",
      supportingFigure: `${currency(total)} to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`,
      details,
    });
  }

  return out;
}
