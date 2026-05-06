import type { ReactNode } from "react";
import CashFlowSubtabs from "./subtabs";

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function CashFlowLayout({
  children,
  params,
}: LayoutProps) {
  const { id: clientId } = await params;
  return (
    <>
      <CashFlowSubtabs clientId={clientId} />
      {children}
    </>
  );
}
