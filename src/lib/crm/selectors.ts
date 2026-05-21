type HouseholdLike = {
  name: string;
  contacts: Array<{
    role: "primary" | "spouse" | "dependent" | "other";
    firstName: string;
    lastName: string;
    [key: string]: unknown;
  }>;
};

type Contact = HouseholdLike["contacts"][number];

export function getPrimaryContact<H extends HouseholdLike>(household: H): Contact | null {
  return household.contacts.find((c) => c.role === "primary") ?? null;
}

export function getSpouse<H extends HouseholdLike>(household: H): Contact | null {
  return household.contacts.find((c) => c.role === "spouse") ?? null;
}

export function getDisplayName<H extends HouseholdLike>(household: H): string {
  const primary = getPrimaryContact(household);
  return primary ? `${primary.lastName} Household` : household.name;
}
