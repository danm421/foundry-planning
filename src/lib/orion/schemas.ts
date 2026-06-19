// src/lib/orion/schemas.ts
import { z } from "zod";

// Shapes are provisional — confirm field names against Orion's Portfolio API and
// adjust here only. Everything downstream consumes the inferred types.
export const orionHouseholdSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export const orionAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  registrationType: z.string().nullish(),
  custodian: z.string().nullish(),
  accountNumber: z.string().nullish(),
  value: z.number().nullish(),
  costBasis: z.number().nullish(),
});
export const orionPositionSchema = z.object({
  ticker: z.string().nullish(),
  cusip: z.string().nullish(),
  description: z.string().nullish(),
  units: z.number().nullish(),
  price: z.number().nullish(),
  marketValue: z.number().nullish(),
  costBasis: z.number().nullish(),
});

export type OrionHousehold = z.infer<typeof orionHouseholdSchema>;
export type OrionAccount = z.infer<typeof orionAccountSchema>;
export type OrionPosition = z.infer<typeof orionPositionSchema>;
