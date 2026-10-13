/** The user-facing message in a failed API response. Routes use either
 *  `message` or `error`, and a response can fail to parse as JSON at all (a
 *  413, or an HTML 500 page). Always resolves — never throws — so a caller's
 *  error state is reached instead of an uncaught rejection silently returning
 *  the UI to idle. */
export async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}) as { message?: string; error?: string });
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  return fallback;
}
