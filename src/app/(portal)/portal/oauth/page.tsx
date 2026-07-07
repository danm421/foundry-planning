import type { ReactElement } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { PlaidOAuthResume } from "@/components/portal/plaid-oauth-resume-dynamic";

// Landing page for the Plaid OAuth redirect (registered in the Plaid dashboard
// as https://app.foundryplanning.com/portal/oauth). Auth is enforced here and
// by the /api/portal/plaid/* routes the resume view calls.
export default async function PlaidOAuthPage(): Promise<ReactElement> {
  await requireClientPortalAccess();
  return <PlaidOAuthResume />;
}
