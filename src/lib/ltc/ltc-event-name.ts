import type { ClientInfo, LtcEvent } from "@/engine/types";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

/** First name of the person in care, for labels. */
export function ltcPersonFirstName(person: "client" | "spouse", client: ClientInfo): string {
  if (person === "client") return client.firstName;
  return client.spouseName?.trim().split(/\s+/)[0] || CO_CLIENT_LABEL;
}

/** The Changes-list label for an LTC event. Ages, not years, because that is
 *  how the advisor set it up. */
export function ltcEventName(event: Omit<LtcEvent, "name">, client: ClientInfo): string {
  const spans = event.people.map((p) => {
    const first = ltcPersonFirstName(p.person, client);
    const last = p.startAge + p.years - 1;
    return p.years === 1 ? `${first} ${p.startAge}` : `${first} ${p.startAge}–${last}`;
  });
  const sale = event.homeSale ? ` · home sold ${event.homeSale.saleYear}` : "";
  return `Long-term care — ${spans.join(", ")}${sale}`;
}
