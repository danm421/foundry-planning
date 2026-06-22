import type { ReactElement } from "react";
import TransactionsList from "@/components/portal/transactions-list";

export default function TransactionsSection({
  clientId,
  previewing = false,
}: {
  clientId: string;
  previewing?: boolean;
}): ReactElement {
  return (
    <div className="max-w-3xl space-y-5 p-5">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-ink">Transactions</h1>
        <p className="text-[13px] text-ink-3">
          Spending and income from your linked accounts, categorized automatically.
        </p>
      </header>
      <TransactionsList clientId={clientId} editEnabled={!previewing} />
    </div>
  );
}
