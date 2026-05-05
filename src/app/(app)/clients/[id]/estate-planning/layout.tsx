import type { ReactNode } from "react";
import EstatePlanningSubtabs from "./subtabs";

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function EstatePlanningLayout({
  children,
  params,
}: LayoutProps) {
  const { id: clientId } = await params;
  return (
    <>
      <EstatePlanningSubtabs clientId={clientId} />
      {children}
    </>
  );
}
