import type { ReactElement, ReactNode } from "react";
import { requireClientPortalAccess } from "@/lib/authz";

/**
 * Top-level layout for the entire portal. Runs once per request,
 * ensures the caller is a bound portal user, and forwards rendering
 * to nested layouts. Middleware should have already redirected
 * non-portal users — this is defense in depth.
 */
export default async function PortalRootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  await requireClientPortalAccess();
  return <>{children}</>;
}
