// src/lib/integrations/providers/schwab/schemas.ts
import { z } from "zod";

/**
 * PLACEHOLDER SHAPES — Schwab Advisor Services is not publicly documented, so
 * these encode our target contract, not a verified one. They exist so the
 * client has something to parse into once credentials land; nothing consumes
 * them while the transport throws ProviderNotConfigured.
 *
 * When credentials arrive, the ONLY files that should need edits are this one,
 * ./client.ts, and ./oauth.ts.
 */
export const schwabHouseholdSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const schwabAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  registrationType: z.string().nullish(),
  custodian: z.string().nullish(),
  accountNumber: z.string().nullish(),
  value: z.number().nullish(),
  costBasis: z.number().nullish(),
});

export const schwabPositionSchema = z.object({
  ticker: z.string().nullish(),
  cusip: z.string().nullish(),
  description: z.string().nullish(),
  units: z.number().nullish(),
  price: z.number().nullish(),
  marketValue: z.number().nullish(),
  costBasis: z.number().nullish(),
});
