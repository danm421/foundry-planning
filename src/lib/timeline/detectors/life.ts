import type { ClientData, ProjectionYear } from "@/engine";
import type { TimelineEvent } from "../timeline-types";

const MEDICARE_AGE = 65;
const SS_FRA_AGE = 67;

function birthYear(dob: string): number {
  return new Date(dob).getUTCFullYear();
}

function yearAtAge(dob: string, age: number): number {
  return birthYear(dob) + age;
}

function inRange(year: number, projection: ProjectionYear[]): boolean {
  if (projection.length === 0) return false;
  return year >= projection[0].year && year <= projection[projection.length - 1].year;
}

function pushAgeEvent(
  out: TimelineEvent[],
  idSuffix: string,
  subject: "primary" | "spouse",
  subjectLabel: string,
  dob: string,
  age: number,
  title: string,
  supportingFigure: string | undefined,
  projection: ProjectionYear[],
) {
  const year = yearAtAge(dob, age);
  if (!inRange(year, projection)) return;
  out.push({
    id: `life:${idSuffix}:${subject}`,
    year,
    age,
    category: "life",
    subject,
    title,
    supportingFigure,
    details: [
      { label: "Subject", value: subjectLabel },
      { label: "Age", value: String(age) },
    ],
  });
}

export function detectLifeEvents(
  data: ClientData,
  projection: ProjectionYear[],
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const c = data.client;

  const primaryName = `${c.firstName} ${c.lastName}`.trim();
  pushAgeEvent(out, "retire", "primary", primaryName, c.dateOfBirth, c.retirementAge, "Retirement", `${primaryName} retires`, projection);
  pushAgeEvent(out, "medicare", "primary", primaryName, c.dateOfBirth, MEDICARE_AGE, "Medicare eligibility", "Age 65", projection);
  pushAgeEvent(out, "ss_fra", "primary", primaryName, c.dateOfBirth, SS_FRA_AGE, "Social Security FRA", "Full Retirement Age", projection);
  if (c.lifeExpectancy != null) {
    pushAgeEvent(out, "death", "primary", primaryName, c.dateOfBirth, c.lifeExpectancy, "End of life", undefined, projection);
  }

  // SS claim age — find the primary's social_security income with claimingAge set.
  const primarySS = data.incomes.find((i) => i.type === "social_security" && i.owner === "client" && i.claimingAge != null);
  if (primarySS && primarySS.claimingAge != null) {
    pushAgeEvent(out, "ss_claim", "primary", primaryName, c.dateOfBirth, primarySS.claimingAge, "Social Security begins", `Claim at age ${primarySS.claimingAge}`, projection);
  }

  if (c.spouseName && c.spouseDob) {
    const spouseFullName = c.spouseName;
    if (c.spouseRetirementAge != null) {
      pushAgeEvent(out, "retire", "spouse", spouseFullName, c.spouseDob, c.spouseRetirementAge, "Retirement", `${spouseFullName} retires`, projection);
    }
    pushAgeEvent(out, "medicare", "spouse", spouseFullName, c.spouseDob, MEDICARE_AGE, "Medicare eligibility", "Age 65", projection);
    pushAgeEvent(out, "ss_fra", "spouse", spouseFullName, c.spouseDob, SS_FRA_AGE, "Social Security FRA", "Full Retirement Age", projection);
    if (c.spouseLifeExpectancy != null) {
      pushAgeEvent(out, "death", "spouse", spouseFullName, c.spouseDob, c.spouseLifeExpectancy, "End of life", undefined, projection);
    }

    const spouseSS = data.incomes.find((i) => i.type === "social_security" && i.owner === "spouse" && i.claimingAge != null);
    if (spouseSS && spouseSS.claimingAge != null) {
      pushAgeEvent(out, "ss_claim", "spouse", spouseFullName, c.spouseDob, spouseSS.claimingAge, "Social Security begins", `Claim at age ${spouseSS.claimingAge}`, projection);
    }
  }

  return out;
}
