import type { ClientInfo } from "@/engine/types";

export interface LifeEvent {
  label: string;
  color: string;
}

export type LifeEventsByYear = Record<number, LifeEvent[]>;

const DEFAULT_LIFE_EXPECTANCY = 95;
const CLIENT_COLOR = "#60a5fa";
const SPOUSE_COLOR = "#f472b6";

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
    const spouseFirst = client.spouseName ?? "Spouse";
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
