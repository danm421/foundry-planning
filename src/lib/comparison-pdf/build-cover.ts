import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "./branding";

export interface CoverClientFields {
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export interface CoverProps {
  title: string;
  householdName: string;
  eyebrow: string;
  advisorName: string;
  asOfIso: string;
  primaryColor: string;
  firmName: string;
  logoDataUrl: string | null;
}

export interface BuildCoverInput {
  layout: ComparisonLayoutV5;
  client: CoverClientFields;
  branding: BrandingResolved;
  advisorName: string;
  asOf: Date;
}

export function buildCoverProps(input: BuildCoverInput): CoverProps {
  const { layout, client, branding, advisorName, asOf } = input;
  return {
    title: layout.title,
    householdName: householdName(client),
    eyebrow: `${branding.firmName.toUpperCase()} · ${asOf.getUTCFullYear()}`,
    advisorName,
    asOfIso: asOf.toISOString().slice(0, 10),
    primaryColor: branding.primaryColor,
    firmName: branding.firmName,
    logoDataUrl: branding.logoDataUrl,
  };
}

function householdName(c: CoverClientFields): string {
  const lastName = c.lastName.trim();
  if (!c.spouseName) return `${c.firstName} ${lastName}`.trim();
  const sharedLast = (c.spouseLastName?.trim() || lastName);
  return `${c.firstName} & ${c.spouseName} ${sharedLast}`.trim();
}
