// src/lib/workspace/types.ts

/** A Microsoft identity-platform token response, normalized. */
export type MicrosoftTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string;
  idToken: string | null;
};

/** The id_token claims Foundry keys a connection on (`tid`, `oid`, `preferred_username`). */
export type IdTokenClaims = {
  tenantId: string;
  userObjectId: string;
  email: string;
};
