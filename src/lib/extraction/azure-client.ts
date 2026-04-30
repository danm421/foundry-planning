import { AzureOpenAI } from "openai";

let cachedClient: AzureOpenAI | null = null;
let cachedKey = "";

function getClient(): AzureOpenAI {
  const apiKey = process.env.AZURE_API_KEY ?? "";
  const endpoint = process.env.AZURE_ENDPOINT ?? "";
  const apiVersion = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

  if (!apiKey) {
    throw new Error(
      "AZURE_API_KEY is not configured. Set it in .env.local to enable document extraction."
    );
  }

  if (cachedClient && cachedKey === apiKey) return cachedClient;

  cachedClient = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion,
  });
  cachedKey = apiKey;
  return cachedClient;
}

/**
 * Call Azure OpenAI for document extraction.
 */
export async function callAIExtraction(
  systemPrompt: string,
  userPrompt: string,
  model: "mini" | "full" = "mini"
): Promise<string> {
  const client = getClient();
  const modelName =
    model === "full"
      ? (process.env.AZURE_ANALYSIS_MODEL ?? "gpt-5.4")
      : (process.env.AZURE_MODEL ?? "gpt-5.4-mini");

  // Removed `x-ms-azureai-sensitivity: "high"` request header
  // (commit e2834b0). The header was added as defense-in-depth for
  // Partial-ZDR routing, but in practice every extraction (small or
  // large, sensitive or bland) returned 400 "The response was filtered
  // due to the prompt triggering Azure OpenAI's content management
  // policy" once it landed. Verified during the Phase 8 smoke: a
  // 4kB blank-presentation PDF tripped the same filter as a real
  // fact-finder. ZDR is already granted at the resource level by
  // Microsoft, so dropping this header changes nothing about
  // retention posture. Re-add later only with a verified value
  // and a link to the relevant Azure doc.
  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    // 16k keeps completions inside our 60s function budget and caps cost
    // exposure per request (see SECURITY_AUDIT.md §C7).
    max_completion_tokens: 16000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned empty content");
  }

  return content;
}
