// src/app/(app)/clients/[id]/cashflow/ledgers/layout.tsx
import type { ReactElement, ReactNode } from "react";
import LedgersSubtabs from "@/components/ledgers-subtabs";

interface LedgersLayoutProps {
  params: Promise<{ id: string }>;
  children: ReactNode;
}

export default async function LedgersLayout({
  params,
  children,
}: LedgersLayoutProps): Promise<ReactElement> {
  const { id } = await params;
  return (
    <div>
      <div className="px-6 pt-6">
        <LedgersSubtabs clientId={id} />
      </div>
      {children}
    </div>
  );
}
