// src/lib/schemas/client-profile.ts
//
// The household-profile fields the Forge may change: each person's date of
// birth, retirement age and retirement month. PUT /api/clients/[id] checks
// none of these itself, so this schema is what keeps an impossible date or an
// age out of the plan — the Forge's tool and its approval card both parse it.
import { z } from "zod";

const birthDate = z.iso.date("Must be a real date in yyyy-mm-dd form");
const retirementAge = z.number().int().min(18).max(100);
const retirementMonth = z.number().int().min(1).max(12);

export const clientProfileUpdateSchema = z.object({
  dateOfBirth: birthDate.optional().describe("the client's (primary person's) date of birth"),
  retirementAge: retirementAge.optional().describe("the client's retirement age"),
  retirementMonth: retirementMonth
    .optional()
    .describe("the month the client retires, 1 = January — only if the advisor gave one"),
  spouseDob: birthDate.optional().describe("the co-client's date of birth"),
  spouseRetirementAge: retirementAge.optional().describe("the co-client's retirement age"),
  spouseRetirementMonth: retirementMonth
    .optional()
    .describe("the month the co-client retires, 1 = January — only if the advisor gave one"),
});

export type ClientProfileUpdate = z.infer<typeof clientProfileUpdateSchema>;
