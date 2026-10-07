import { cache } from "react";
import { notFound } from "next/navigation";
import { nullOnAccessDenial } from "@/lib/authz";
import { requireClientAccess, type ClientAccess } from "./authz";

/**
 * The client-access gate for a client workspace page or layout: the full rule
 * (firm, advisor book, Private client, shares) via `requireClientAccess`, with
 * a denial rendered as "not found" so existence never leaks.
 *
 * Every page and nested layout under `clients/[id]` calls this in its own
 * body. The parent layout calling it is not enough: Next renders a page
 * without its parent layouts when the RSC request claims those segments are
 * already on the client. `cache()` makes the layout's call and the page's call
 * one lookup per request. Only an access denial becomes notFound(); a DB fault
 * still surfaces as an error.
 */
export const requireClientPageAccess = cache(async (clientId: string): Promise<ClientAccess> => {
  const access = await requireClientAccess(clientId).catch(nullOnAccessDenial);
  if (!access) notFound();
  return access;
});
