import type { ClientInfo } from "@/engine/types";
import { colors } from "@/brand";
import { personLabel } from "@/lib/owner-labels";

export interface LifeEvent {
  label: string;
  color: string;
}

export type LifeEventsByYear = Record<number, LifeEvent[]>;

const DEFAULT_LIFE_EXPECTANCY = 95;
const CLIENT_COLOR = colors.cat.portfolio; // #60a5fa dark, resolved at module init
const SPOUSE_COLOR = colors.cat.insurance; // #e879f9 dark

export function buildLifeEventsByYear(client: ClientInfo): LifeEventsByYear {
  const events: LifeEventsByYear = {};
  const push = (year: number, ev: LifeEvent) => {
    (events[year] ??= []).push(ev);
  };

  const clientBirth = parseInt(client.dateOfBirth.slice(0, 4), 10);
  push(clientBirth + client.retirementAge, {
    label: `${client.firstName} retires`,
    color: CLIENT_COLOR,
  });
  push(clientBirth + (client.lifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY), {
    label: `${client.firstName} passes`,
    color: CLIENT_COLOR,
  });

  if (client.spouseDob) {
    const spouseBirth = parseInt(client.spouseDob.slice(0, 4), 10);
    const spouseFirst = personLabel("spouse", { clientName: client.firstName, spouseName: client.spouseName ?? null });
    if (client.spouseRetirementAge != null) {
      push(spouseBirth + client.spouseRetirementAge, {
        label: `${spouseFirst} retires`,
        color: SPOUSE_COLOR,
      });
    }
    push(
      spouseBirth + (client.spouseLifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY),
      { label: `${spouseFirst} passes`, color: SPOUSE_COLOR },
    );
  }

  return events;
}

/** Chart timeline markers for the events that fall within the charted years,
 *  indexed from the first one (the chart's first bar). */
export function lifeEventMarkers(
  events: LifeEventsByYear,
  years: readonly { year: number }[],
): (LifeEvent & { yearIndex: number })[] {
  if (years.length === 0) return [];
  const firstYear = years[0].year;
  const lastYear = years[years.length - 1].year;
  const markers: (LifeEvent & { yearIndex: number })[] = [];
  for (const [yearStr, yearEvents] of Object.entries(events)) {
    const year = Number(yearStr);
    if (year < firstYear || year > lastYear) continue;
    for (const ev of yearEvents) markers.push({ yearIndex: year - firstYear, ...ev });
  }
  return markers;
}
