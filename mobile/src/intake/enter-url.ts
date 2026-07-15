// mobile/src/intake/enter-url.ts
//
// Pure helper — builds the public web URL the intake WebView loads to
// consume a Clerk sign-in ticket and establish a web cookie session.

export function buildIntakeEnterUrl(baseUrl: string, ticket: string): string {
  return `${baseUrl}/intake/enter?ticket=${encodeURIComponent(ticket)}`;
}
