// src/lib/workspace/google/test-fixtures.ts
// Shared by the Google calendar and tasks tests; nothing outside a test imports it.
import { vi } from "vitest";
import type { WorkspaceConnection } from "../connections";
import type { GoogleContext } from "./api";

/** A connected Google account whose access token is good until 2099, so no test refreshes it. */
const conn: WorkspaceConnection = {
  id: "conn-1",
  firmId: "firm-1",
  userId: "user-1",
  provider: "google",
  tenantId: "",
  externalUserId: "sub-1",
  externalEmail: "advisor@gmail.test",
  accessToken: "AT",
  refreshToken: "RT",
  tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  scope: "calendar.events tasks",
  status: "connected",
  lastError: null,
  connectedAt: new Date("2026-01-01T00:00:00Z"),
};

export function json(body?: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

/** A context whose fetch answers `responses` in order; `call(i)` is the i-th request, parsed. */
export function setup(...responses: Response[]) {
  const fetchImpl = vi.fn();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const ctx: GoogleContext = { conn, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} };
  const call = (i: number) => {
    const [url, init] = fetchImpl.mock.calls[i] as [string, RequestInit];
    return {
      url: new URL(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
  };
  return { ctx, fetchImpl, call };
}
