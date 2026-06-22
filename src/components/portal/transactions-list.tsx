"use client";

// TODO(Task 11): replace with full interactive list

export type PortalTransactionDTO = {
  id: string;
  date: string;
  amount: number;
  name: string;
  category: string | null;
};

export default function TransactionsList({
  clientId: _clientId,
  editEnabled: _editEnabled,
}: {
  clientId: string;
  editEnabled: boolean;
}) {
  return <div data-testid="transactions-list-placeholder" />;
}
