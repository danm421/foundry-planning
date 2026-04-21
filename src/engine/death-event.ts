import type { ClientInfo } from "./types";

/** Compute the year of the first-death event. Returns null when there is no
 *  spouse, when no lifeExpectancy is set, or when the earliest death falls
 *  outside the plan horizon. When both spouses die in the same year, client
 *  is treated as dying first (deterministic convention — see spec 4b).
 */
export function computeFirstDeathYear(
  client: ClientInfo,
  planStartYear: number,
  planEndYear: number,
): number | null {
  if (!client.spouseDob) return null;
  if (client.lifeExpectancy == null) return null;

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = parseInt(client.spouseDob.slice(0, 4), 10);

  const clientDeathYear = clientBirthYear + client.lifeExpectancy;
  // Match the orchestrator's fallback: null spouseLifeExpectancy → 95
  const spouseLE = client.spouseLifeExpectancy ?? 95;
  const spouseDeathYear = spouseBirthYear + spouseLE;

  // Tiebreaker: client first when equal
  const firstDeathYear =
    clientDeathYear <= spouseDeathYear ? clientDeathYear : spouseDeathYear;

  if (firstDeathYear < planStartYear || firstDeathYear > planEndYear) {
    return null;
  }
  return firstDeathYear;
}

/** Given the first-death year, identify who died first. */
export function identifyDeceased(
  client: ClientInfo,
  firstDeathYear: number,
): "client" | "spouse" {
  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const clientDeathYear = clientBirthYear + (client.lifeExpectancy ?? 95);
  // Tiebreaker: client first
  return clientDeathYear <= firstDeathYear ? "client" : "spouse";
}
