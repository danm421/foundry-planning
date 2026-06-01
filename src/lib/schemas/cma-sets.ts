import { z } from "zod";

// Each value is a decimal string (matches Drizzle decimal columns).
const decimalStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const cmaSetValuesUpdateSchema = z.object({
  values: z
    .array(
      z.object({
        assetClassId: z.string().uuid(),
        geometricReturn: decimalStr,
        arithmeticMean: decimalStr,
        volatility: decimalStr,
      }),
    )
    .min(1),
});
export type CmaSetValuesUpdate = z.infer<typeof cmaSetValuesUpdateSchema>;
