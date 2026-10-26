// src/app/api/integrations/[provider]/_addepar.ts
//
// Shared pieces between the Addepar BYOK routes — `connect` (a new
// connection), `connections/[connectionId]/credentials` (a reconnect) and
// `test`: the credential-field schemas and the ephemeral `ProviderCallContext`
// used to validate credentials via `testAddeparConnection`.
import { z } from "zod";
import {
  addeparApiBaseSchema,
  encodeAddeparConfig,
  encodeAddeparSecret,
} from "@/lib/integrations/providers/addepar/credentials";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import { CredentialsRejected } from "@/lib/integrations/errors";
import type { ProviderCallContext, ProviderId } from "@/lib/integrations/types";

/** The 4 BYOK credential fields every route takes. `test` uses it as-is. */
export const addeparCredsSchema = z.object({
  apiBase: addeparApiBaseSchema,
  addeparFirmId: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

/** A connect or reconnect: the credentials, the attestation checkbox and the connection's name. */
const addeparConnectBody = addeparCredsSchema.extend({
  attestation: z.literal(true, "attestation required"),
  name: z.string().trim().min(1).max(60),
});

/**
 * Builds the ephemeral `ProviderCallContext` used to validate BYOK
 * credentials against the live Addepar API. Takes the already-encoded
 * secret blob so a caller stores exactly the blob it tested.
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
    config: { apiBase: input.apiBase, addeparFirmId: input.addeparFirmId },
    getToken: async () => input.secretBlob,
    fetchImpl: undefined,
  };
}

/**
 * Reads a connect or reconnect body and tests its credentials against the
 * live Addepar API before anything is stored. Returns the name and encoded
 * blobs to store, or the message for a 400. Only a bad body or a failed
 * credential test is a 400; anything else throws, for the route's 500.
 */
export async function readTestedAddeparCredentials(
  req: Request,
  firmId: string,
): Promise<{ name: string; secretBlob: string; configBlob: string } | { error: string }> {
  const parsed = addeparConnectBody.safeParse(await req.json());
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { apiBase, addeparFirmId, apiKey, apiSecret, name } = parsed.data;
  const secretBlob = encodeAddeparSecret({ apiKey, apiSecret });

  try {
    await testAddeparConnection(
      buildAddeparTestContext({ firmId, providerId: "addepar", apiBase, addeparFirmId, secretBlob }),
    );
  } catch (err) {
    return {
      error: err instanceof CredentialsRejected ? err.message : "Could not connect to Addepar with those credentials.",
    };
  }
  return { name, secretBlob, configBlob: encodeAddeparConfig({ apiBase, addeparFirmId }) };
}
