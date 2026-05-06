import type { ReactNode } from "react";
import AssetsSubtabs from "./subtabs";

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function AssetsLayout({
  children,
  params,
}: LayoutProps) {
  const { id: clientId } = await params;
  return (
    <>
      <AssetsSubtabs clientId={clientId} />
      {children}
    </>
  );
}
