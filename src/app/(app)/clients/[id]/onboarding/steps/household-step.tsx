"use client";

import AddClientForm, { type ClientFormInitial } from "@/components/forms/add-client-form";
import type { ClientData } from "@/engine/types";
import type { ClientWithContacts } from "@/lib/clients/get-client-with-contacts";

interface HouseholdStepProps {
  clientId: string;
  tree: ClientData;
  contacts: ClientWithContacts | null;
}

export default function HouseholdStep({ clientId, tree, contacts }: HouseholdStepProps) {
  const c = tree.client;
  const initial: ClientFormInitial = {
    id: clientId,
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: c.dateOfBirth,
    retirementAge: c.retirementAge,
    lifeExpectancy: c.lifeExpectancy ?? 95,
    filingStatus: c.filingStatus,
    spouseName: c.spouseName ?? null,
    spouseDob: c.spouseDob ?? null,
    spouseRetirementAge: c.spouseRetirementAge ?? null,
    spouseLifeExpectancy: c.spouseLifeExpectancy ?? null,
    email:              contacts?.email              ?? null,
    phone:              contacts?.phone              ?? null,
    mobile:             contacts?.mobile             ?? null,
    addressLine1:       contacts?.addressLine1       ?? null,
    addressLine2:       contacts?.addressLine2       ?? null,
    city:               contacts?.city               ?? null,
    state:              contacts?.state              ?? null,
    postalCode:         contacts?.postalCode         ?? null,
    country:            contacts?.country            ?? null,
    spouseEmail:        contacts?.spouseEmail        ?? null,
    spousePhone:        contacts?.spousePhone        ?? null,
    spouseMobile:       contacts?.spouseMobile       ?? null,
    spouseAddressLine1: contacts?.spouseAddressLine1 ?? null,
    spouseAddressLine2: contacts?.spouseAddressLine2 ?? null,
    spouseCity:         contacts?.spouseCity         ?? null,
    spouseState:        contacts?.spouseState        ?? null,
    spousePostalCode:   contacts?.spousePostalCode   ?? null,
    spouseCountry:      contacts?.spouseCountry      ?? null,
  };

  return <AddClientForm mode="edit" initial={initial} />;
}
