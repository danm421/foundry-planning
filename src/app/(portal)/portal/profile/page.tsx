import { permanentRedirect } from "next/navigation";

/**
 * Household moved into Organizer. Kept as a redirect rather than deleted:
 * welcome emails and advisor "go fill this in" nudges point at the old path.
 *
 * NOT a 308, despite the function's name. Every route under `(portal)/portal`
 * sits below `loading.tsx`, which flushes the shell before the page runs — a
 * streaming context, in which `permanentRedirect()` is documented to "insert a
 * meta tag to emit the redirect on the client side" instead of serving a 308
 * (`next/dist/docs/01-app/03-api-reference/04-functions/permanentRedirect.md`).
 * Measured: 200, no `Location` header, body carries
 * `<meta id="__next-page-redirect" http-equiv="refresh" content="0;url=…">`.
 * The landing is correct; the hop is client-side, so it is not cacheable as
 * permanent and is invisible to anything that does not run a meta refresh
 * (crawlers, link checkers, `curl -L`). Forcing a real 308 would mean moving
 * these out of the streaming boundary — out of scope here.
 */
export default async function HouseholdPage(): Promise<never> {
  permanentRedirect("/portal/organizer");
}
