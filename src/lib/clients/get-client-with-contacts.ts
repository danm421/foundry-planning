import { db } from "@/db";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { clients, crmHouseholdContacts } from "@/db/schema";

const primary = alias(crmHouseholdContacts, "primary_contact");
const spouse = alias(crmHouseholdContacts, "spouse_contact");

type ClientRow = InferSelectModel<typeof clients>;

type ContactFields = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

type SpouseContactFields = {
  spouseFirstName: string | null;
  spouseLastName: string | null;
  spouseDateOfBirth: string | null;
  spouseEmail: string | null;
  spousePhone: string | null;
  spouseMobile: string | null;
  spouseAddressLine1: string | null;
  spouseAddressLine2: string | null;
  spouseCity: string | null;
  spouseState: string | null;
  spousePostalCode: string | null;
  spouseCountry: string | null;
};

export type ClientWithContacts = ClientRow & ContactFields & SpouseContactFields;

export async function getClientWithContacts(
  clientId: string,
  firmId: string,
): Promise<ClientWithContacts | null> {
  const [row] = await db
    .select({
      client: clients,
      p: {
        firstName: primary.firstName,
        lastName: primary.lastName,
        dateOfBirth: primary.dateOfBirth,
        email: primary.email,
        phone: primary.phone,
        mobile: primary.mobile,
        addressLine1: primary.addressLine1,
        addressLine2: primary.addressLine2,
        city: primary.city,
        state: primary.state,
        postalCode: primary.postalCode,
        country: primary.country,
      },
      s: {
        firstName: spouse.firstName,
        lastName: spouse.lastName,
        dateOfBirth: spouse.dateOfBirth,
        email: spouse.email,
        phone: spouse.phone,
        mobile: spouse.mobile,
        addressLine1: spouse.addressLine1,
        addressLine2: spouse.addressLine2,
        city: spouse.city,
        state: spouse.state,
        postalCode: spouse.postalCode,
        country: spouse.country,
      },
    })
    .from(clients)
    .leftJoin(
      primary,
      and(eq(primary.householdId, clients.crmHouseholdId), eq(primary.role, "primary")),
    )
    .leftJoin(
      spouse,
      and(eq(spouse.householdId, clients.crmHouseholdId), eq(spouse.role, "spouse")),
    )
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
    .limit(1);

  if (!row) return null;

  return {
    ...row.client,
    firstName: row.p?.firstName ?? null,
    lastName: row.p?.lastName ?? null,
    dateOfBirth: row.p?.dateOfBirth ?? null,
    email: row.p?.email ?? null,
    phone: row.p?.phone ?? null,
    mobile: row.p?.mobile ?? null,
    addressLine1: row.p?.addressLine1 ?? null,
    addressLine2: row.p?.addressLine2 ?? null,
    city: row.p?.city ?? null,
    state: row.p?.state ?? null,
    postalCode: row.p?.postalCode ?? null,
    country: row.p?.country ?? null,
    spouseFirstName: row.s?.firstName ?? null,
    spouseLastName: row.s?.lastName ?? null,
    spouseDateOfBirth: row.s?.dateOfBirth ?? null,
    spouseEmail: row.s?.email ?? null,
    spousePhone: row.s?.phone ?? null,
    spouseMobile: row.s?.mobile ?? null,
    spouseAddressLine1: row.s?.addressLine1 ?? null,
    spouseAddressLine2: row.s?.addressLine2 ?? null,
    spouseCity: row.s?.city ?? null,
    spouseState: row.s?.state ?? null,
    spousePostalCode: row.s?.postalCode ?? null,
    spouseCountry: row.s?.country ?? null,
  };
}
