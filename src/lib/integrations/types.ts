// src/lib/integrations/types.ts
import type {
  AccountCategory,
  AccountSubType,
} from "@/lib/extraction/types";

export const PROVIDER_IDS = ["orion", "schwab", "addepar"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  scope?: string;
};

/** Normalized shapes. Each provider's client parses its own raw JSON into these. */
export type ProviderHousehold = { id: string; name: string };

export type ProviderAccount = {
  id: string;
  name: string;
  registrationType?: string | null;
  custodian?: string | null;
  accountNumber?: string | null;
  value?: number | null;
  costBasis?: number | null;
};

export type ProviderPosition = {
  ticker?: string | null;
  cusip?: string | null;
  description?: string | null;
  units?: number | null;
  price?: number | null;
  marketValue?: number | null;
  costBasis?: number | null;
};

/**
 * Passed to every client read. Carries the firm id (for rate-limit keying) and
 * a bound token getter. Threading the getter through here — rather than having
 * the client import auth.ts — is what keeps auth.ts -> oauth and client -> ctx
 * acyclic while preserving the 401-refresh-and-retry behavior.
 */
export type ProviderCallContext = {
  firmId: string;
  providerId: ProviderId;
  getToken: (opts?: { forceRefresh?: boolean }) => Promise<string>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Populated for BYOK providers from the connection's stored config. */
  config?: { apiBase: string; addeparFirmId: string };
};

export interface ProviderOAuth {
  buildAuthorizeUrl(opts: { state: string; challenge: string }): string;
  exchangeCodeForTokens(
    opts: { code: string; codeVerifier: string },
    fetchImpl?: typeof fetch,
  ): Promise<TokenResponse>;
  refreshTokens(refreshToken: string, fetchImpl?: typeof fetch): Promise<TokenResponse>;
}

export interface ProviderClient {
  getHouseholds(ctx: ProviderCallContext): Promise<ProviderHousehold[]>;
  getAccounts(ctx: ProviderCallContext, householdId: string): Promise<ProviderAccount[]>;
  getPositions(ctx: ProviderCallContext, accountId: string): Promise<ProviderPosition[]>;
}

export type RegistrationMap = { category: AccountCategory; subType: AccountSubType };
export type RegistrationTable = Array<[RegExp, RegistrationMap]>;

export type ProviderAuthKind = "oauth" | "byok";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  scope: "firm";
  isEnabled: () => boolean;
  /** How the firm connects. "oauth" uses the redirect flow + `oauth`; "byok" posts API credentials. */
  authKind: ProviderAuthKind;
  /** Present only when authKind === "oauth". */
  oauth?: ProviderOAuth;
  client: ProviderClient;
  registrationTable: RegistrationTable;
  /**
   * When true (OAuth providers), sync auto-commits externalId-matched accounts.
   * When false (Addepar), matched + new accounts both route to a review import;
   * nothing writes until the advisor commits.
   */
  autoCommitExact: boolean;
}
