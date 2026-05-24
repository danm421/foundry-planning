export interface HouseholdNameParts {
  firstName: string;
  lastName: string;
  spouseFirstName?: string | null;
  spouseLastName?: string | null;
}

export function buildHouseholdName(p: HouseholdNameParts): string {
  const firstName = p.firstName.trim();
  const lastName = p.lastName.trim();
  const spouseFirstName = p.spouseFirstName?.trim() ?? "";
  const spouseLastName = p.spouseLastName?.trim() ?? "";

  if (!spouseFirstName) {
    return `${firstName} ${lastName}`.trim();
  }
  const spouseLn = spouseLastName || lastName;
  if (spouseLn === lastName) {
    return `${firstName} & ${spouseFirstName} ${lastName}`;
  }
  return `${firstName} ${lastName} & ${spouseFirstName} ${spouseLn}`;
}
