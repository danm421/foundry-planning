import type { ClientInfo } from "@/engine/types";
import { colors } from "@/brand";
import { personLabel } from "@/lib/owner-labels";

export interface LifeEvent {
  label: string;
  color: string;
  /** Whose event it is — charts give each person their own marker row. */
  person: "client" | "spouse";
  /** The person's first name (the row heading on charts). */
  name: string;
  kind: "retires" | "passes";
}

export type LifeEventsByYear = Record<number, LifeEvent[]>;

export type LifeEventMarker = LifeEvent & { yearIndex: number };

const DEFAULT_LIFE_EXPECTANCY = 95;
const CLIENT_COLOR = colors.cat.portfolio; // #60a5fa dark, resolved at module init
const SPOUSE_COLOR = colors.cat.insurance; // #e879f9 dark

export function buildLifeEventsByYear(client: ClientInfo): LifeEventsByYear {
  const events: LifeEventsByYear = {};
  const push = (year: number, person: LifeEvent["person"], name: string, kind: LifeEvent["kind"]) => {
    (events[year] ??= []).push({
      label: `${name} ${kind}`,
      color: person === "client" ? CLIENT_COLOR : SPOUSE_COLOR,
      person,
      name,
      kind,
    });
  };

  const clientBirth = parseInt(client.dateOfBirth.slice(0, 4), 10);
  push(clientBirth + client.retirementAge, "client", client.firstName, "retires");
  push(
    clientBirth + (client.lifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY),
    "client",
    client.firstName,
    "passes",
  );

  if (client.spouseDob) {
    const spouseBirth = parseInt(client.spouseDob.slice(0, 4), 10);
    const spouseFirst = personLabel("spouse", { clientName: client.firstName, spouseName: client.spouseName ?? null });
    if (client.spouseRetirementAge != null) {
      push(spouseBirth + client.spouseRetirementAge, "spouse", spouseFirst, "retires");
    }
    push(
      spouseBirth + (client.spouseLifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY),
      "spouse",
      spouseFirst,
      "passes",
    );
  }

  return events;
}

/** Chart timeline markers for the events that fall within the charted years,
 *  indexed from the first one (the chart's first bar). */
export function lifeEventMarkers(
  events: LifeEventsByYear,
  years: readonly { year: number }[],
): LifeEventMarker[] {
  if (years.length === 0) return [];
  const firstYear = years[0].year;
  const lastYear = years[years.length - 1].year;
  const markers: LifeEventMarker[] = [];
  for (const [yearStr, yearEvents] of Object.entries(events)) {
    const year = Number(yearStr);
    if (year < firstYear || year > lastYear) continue;
    for (const ev of yearEvents) markers.push({ yearIndex: year - firstYear, ...ev });
  }
  return markers;
}
