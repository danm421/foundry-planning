// src/lib/extraction/identify-household.ts
//
// Cheap, clientless identity "peek" for the global-Forge attach-first flow.
// Parses a bounded chunk of the document and makes ONE mini-model call to decide
// "is this a household doc + who are the people" — deliberately NOT the expensive
// multi-pass extractor (which extractDocument routes fact finders through). No DB,
// no blob, no persistence. Framework-free per src/lib/extraction/ purity rule.
import { z } from "zod";
import { extractPdfText } from "./pdf-parser";
import { extractExcelText } from "./excel-parser";
import { extractDocxText } from "./docx-parser";
import { visionOcrImage } from "./vision-ocr";
import { redactSsns } from "./redact-ssn";
import { callAIExtraction } from "./azure-client";
import { parseAIResponse } from "./parse-response";
import type { UploadKind } from "./validate-upload";

export interface HouseholdIdentity {
  householdName: string;
  primary?: { firstName: string; lastName?: string; dateOfBirth?: string };
  spouse?: { firstName: string; lastName?: string; dateOfBirth?: string };
  dependents: { firstName: string; lastName?: string; dateOfBirth?: string }[];
  state?: string;
  filingStatus?: "single" | "married_joint" | "married_separate" | "head_of_household";
  retirementAge?: number;
  lifeExpectancy?: number;
}

export interface IdentifyResult {
  isHouseholdDoc: boolean;
  identity?: HouseholdIdentity;
}

const IDENTITY_SYSTEM_PROMPT = [
  "You read a financial-planning document and extract ONLY the household's identity.",
  "A 'household document' is a fact finder, planning questionnaire, or planning-software",
  "report that describes one household's people (names, dates of birth). If the document",
  "does NOT describe a household's people (e.g. a single bank statement, a recipe, a",
  "marketing PDF), return {\"isHouseholdDoc\": false}.",
  "Otherwise return STRICT JSON with this exact shape (omit unknown fields):",
  '{"isHouseholdDoc": true, "householdName": string, "primary": {"firstName": string, "lastName"?: string, "dateOfBirth"?: "YYYY-MM-DD"}, "spouse"?: {...}, "dependents": [{...}], "state"?: "2-letter USPS", "filingStatus"?: "single"|"married_joint"|"married_separate"|"head_of_household", "retirementAge"?: number, "lifeExpectancy"?: number}',
  "householdName is usually the shared last name (e.g. 'Martin'). Convert any state name",
  "to its 2-letter USPS code (California -> CA, Texas -> TX). Use the filing-status values",
  "shown, NOT 'married_filing_jointly'. Return ONLY the JSON, no prose.",
].join(" ");

const identitySchema = z.object({
  isHouseholdDoc: z.boolean(),
  householdName: z.string().min(1).max(200).optional(),
  primary: z
    .object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().max(100).optional(),
      dateOfBirth: z.string().max(20).optional(),
    })
    .optional(),
  spouse: z
    .object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().max(100).optional(),
      dateOfBirth: z.string().max(20).optional(),
    })
    .optional(),
  dependents: z
    .array(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().max(100).optional(),
        dateOfBirth: z.string().max(20).optional(),
      }),
    )
    .optional(),
  state: z.string().length(2).optional(),
  filingStatus: z
    .enum(["single", "married_joint", "married_separate", "head_of_household"])
    .optional(),
  retirementAge: z.number().int().min(30).max(90).optional(),
  lifeExpectancy: z.number().int().min(60).max(120).optional(),
});

async function parseText(buffer: Buffer, kind: UploadKind): Promise<string> {
  try {
    if (kind === "pdf") return await extractPdfText(buffer);
    if (kind === "xlsx" || kind === "csv") return await extractExcelText(buffer);
    if (kind === "docx") return await extractDocxText(buffer);
    if (kind === "png" || kind === "jpeg") return await visionOcrImage(buffer, { model: "mini" });
  } catch {
    return "";
  }
  return "";
}

export async function identifyHousehold(
  buffer: Buffer,
  _fileName: string,
  kind: UploadKind,
): Promise<IdentifyResult> {
  const text = await parseText(buffer, kind);
  if (!text || text.trim().length < 30) return { isHouseholdDoc: false };

  // Identity lives up front; bound the prompt to keep this a cheap single call.
  const redacted = redactSsns(text).text.slice(0, 8000);
  let raw: string;
  try {
    raw = await callAIExtraction(IDENTITY_SYSTEM_PROMPT, `<document>\n${redacted}\n</document>`, "mini");
  } catch {
    return { isHouseholdDoc: false };
  }

  let parsed: z.infer<typeof identitySchema>;
  try {
    parsed = identitySchema.parse(parseAIResponse(raw));
  } catch {
    return { isHouseholdDoc: false };
  }
  if (!parsed.isHouseholdDoc || !parsed.primary) return { isHouseholdDoc: false };

  return {
    isHouseholdDoc: true,
    identity: {
      householdName: parsed.householdName ?? parsed.primary.lastName ?? parsed.primary.firstName,
      primary: parsed.primary,
      spouse: parsed.spouse,
      dependents: parsed.dependents ?? [],
      state: parsed.state,
      filingStatus: parsed.filingStatus,
      retirementAge: parsed.retirementAge,
      lifeExpectancy: parsed.lifeExpectancy,
    },
  };
}
