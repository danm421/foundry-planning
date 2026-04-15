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

  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 65000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned empty content");
  }

  return content;
}
