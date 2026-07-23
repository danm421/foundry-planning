// src/lib/integrations/providers/addepar/schemas.ts
import { z } from "zod";

export const addeparHouseholdSchema = z.object({ id: z.string(), name: z.string() });

export const addeparAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  registrationType: z.string().default(""),
  custodian: z.string().nullish(),
  accountNumber: z.string().nullish(),
  value: z.number().nullish(),
  costBasis: z.number().nullish(),
});

export const addeparPositionSchema = z.object({
  ticker: z.string().nullish(),
  cusip: z.string().nullish(),
  description: z.string().nullish(),
  units: z.number().nullish(),
  price: z.number().nullish(),
  marketValue: z.number().nullish(),
  costBasis: z.number().nullish(),
});
