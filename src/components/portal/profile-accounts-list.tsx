"use client";
import type { ReactElement } from "react";

interface Props {
  rows: Array<{
    id: string;
    name: string;
    category: string;
    subType: string;
    value: string;
    accountNumberLast4: string | null;
    owners: Array<{ familyMemberId: string | null; entityId: string | null; percent: string }>;
  }>;
  familyMembers: Array<{ id: string; firstName: string; lastName: string | null; role: string }>;
  trustEntities: Array<{ id: string; name: string }>;
  editEnabled: boolean;
}

export default function ProfileAccountsList(_props: Props): ReactElement {
  return <div data-testid="accounts-list-stub" />;
}
