import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent, TimelineEventDetail } from "../timeline-types";

function currency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

/** Total cash flowing in to a trust in one year. Pulls from the trust cashflow row's transfersIn + income. */
function trustInflow(py: ProjectionYear, trustId: string): number {
  const row = py.entityCashFlow?.get(trustId);
  if (!row || row.kind !== "trust") return 0;
  return Math.max(0, (row.transfersIn ?? 0) + (row.income ?? 0));
}

export function detectTrustFundingEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  const trustEntities = (data.entities ?? []).filter((e) => !!e.trustSubType);
  const trustNameById = new Map<string, string>();
  const trustSubTypeById = new Map<string, string>();
  for (const t of trustEntities) {
    trustNameById.set(t.id, t.name ?? t.id);
    if (t.trustSubType) trustSubTypeById.set(t.id, t.trustSubType);
  }
  const trustIds = new Set(trustEntities.map((t) => t.id));

  // Pass 1: gift-based funding, grouped by (trustId, year)
  type GiftBucket = { total: number; gifts: NonNullable<ClientData["gifts"]> };
  const bucketsByTrust = new Map<string, Map<number, GiftBucket>>();
  for (const g of data.gifts ?? []) {
    if (!g.recipientEntityId || !trustIds.has(g.recipientEntityId)) continue;
    if (!inRange(g.year, projection)) continue;
    const perYear = bucketsByTrust.get(g.recipientEntityId) ?? new Map<number, GiftBucket>();
    const bucket = perYear.get(g.year) ?? { total: 0, gifts: [] };
    bucket.total += g.amount;
    bucket.gifts.push(g);
    perYear.set(g.year, bucket);
    bucketsByTrust.set(g.recipientEntityId, perYear);
  }

  for (const [trustId, perYear] of bucketsByTrust) {
    const trustName = trustNameById.get(trustId) ?? trustId;
    for (const [year, bucket] of perYear) {
      const outrightCount = bucket.gifts.filter((g) => g.eventKind !== "clt_remainder_interest").length;
      const cltCount = bucket.gifts.length - outrightCount;
      const grantors = Array.from(new Set(bucket.gifts.map((g) => g.grantor))).join(", ");
      const crummeyCount = bucket.gifts.filter((g) => g.useCrummeyPowers).length;

      const details: TimelineEventDetail[] = [
        { label: "Grantor(s)", value: grantors },
        { label: "Gifts", value: `${bucket.gifts.length} (${outrightCount} outright, ${cltCount} CLT remainder)` },
        { label: "Crummey gifts", value: String(crummeyCount) },
      ];
      for (const g of bucket.gifts) {
        details.push({ label: `Gift ${g.id}`, value: `${currency(g.amount)} from ${g.grantor}` });
      }

      out.push({
        id: `estate:trust_funding:${trustId}:${year}`,
        year,
        category: "estate",
        subject: "joint",
        title: `${trustName} funded`,
        supportingFigure: `${currency(bucket.total)} contributed`,
        details,
      });
    }
  }

  // Pass 2: first-asset-transfer detection for trusts with no Pass-1 event at or before first activity year.
  const earliestGiftYearByTrust = new Map<string, number>();
  for (const [trustId, perYear] of bucketsByTrust) {
    let earliest = Infinity;
    for (const year of perYear.keys()) if (year < earliest) earliest = year;
    if (earliest !== Infinity) earliestGiftYearByTrust.set(trustId, earliest);
  }

  for (const trustId of trustIds) {
    let firstActivityYear: number | null = null;
    for (const py of projection) {
      const inflow = trustInflow(py, trustId);
      if (inflow > 0) {
        firstActivityYear = py.year;
        break;
      }
    }
    if (firstActivityYear == null) continue;
    const earliestGift = earliestGiftYearByTrust.get(trustId) ?? Infinity;
    if (earliestGift <= firstActivityYear) continue;

    const trustName = trustNameById.get(trustId) ?? trustId;
    const subType = trustSubTypeById.get(trustId);
    const firstPy = projection.find((py) => py.year === firstActivityYear);
    const inflowValue = firstPy ? trustInflow(firstPy, trustId) : 0;

    out.push({
      id: `estate:trust_funding:${trustId}:initial`,
      year: firstActivityYear,
      category: "estate",
      subject: "joint",
      title: `${trustName} funded`,
      supportingFigure: "Initial funding",
      details: [
        ...(subType ? [{ label: "Trust sub-type", value: subType }] : []),
        { label: "First-year inflow", value: currency(inflowValue) },
        { label: "Source", value: "Account ownership transfer (not via gift)" },
      ],
    });
  }

  return out;
}
