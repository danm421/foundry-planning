"use client";

import AddClientForm, { type ClientFormInitial } from "@/components/forms/add-client-form";
import type { ClientData } from "@/engine/types";

interface HouseholdStepProps {
  clientId: string;
  tree: ClientData;
}

export default function HouseholdStep({ clientId, tree }: HouseholdStepProps) {
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
  };

  return <AddClientForm mode="edit" initial={initial} />;
}
