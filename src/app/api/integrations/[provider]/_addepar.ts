// src/app/api/integrations/[provider]/_addepar.ts
//
// Shared pieces between the Addepar BYOK `connect` and `test` routes: the
// common credential-field schema and the ephemeral `ProviderCallContext`
// builder used to validate credentials via `testAddeparConnection`.
import { z } from "zod";
import type { ProviderCallContext, ProviderId } from "@/lib/integrations/types";

/** The 4 BYOK credential fields shared by both routes. `connect` extends this
 * with the attestation checkbox; `test` uses it as-is. */
export const addeparCredsSchema = z.object({
  apiBase: z.string().url(),
  addeparFirmId: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

/**
 * Builds the ephemeral `ProviderCallContext` used to validate BYOK
 * credentials against the live Addepar API. Takes the already-encoded
 * secret blob so `connect` can reuse the same blob for `upsertByokConnection`
 * rather than encoding it twice.
 */
export function buildAddeparTestContext(input: {
  firmId: string;
  providerId: ProviderId;
  apiBase: string;
  addeparFirmId: string;
  secretBlob: string;
}): ProviderCallContext {
  return {
    firmId: input.firmId,
    providerId: input.providerId,
    baseUrl: input.apiBase,
    config: { apiBase: input.apiBase, addeparFirmId: input.addeparFirmId },
    getToken: async () => input.secretBlob,
    fetchImpl: undefined,
  };
}
