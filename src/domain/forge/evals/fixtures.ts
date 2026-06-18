import type { ForgeAuthContext } from "../state";

/** Fixed, fake scope for offline evals — never hits Clerk/DB. */
export const EVAL_AUTH: ForgeAuthContext = {
  userId: "user_eval",
  firmId: "org_eval",
  clientId: "client_eval",
  scenarioId: "base",
};

/** A stable system prompt for evals — avoids loadPromptContext's DB reads. */
export const evalSystemPrompt = () =>
  "You are Forge, a financial-planning assistant. Use tools to answer. Never invent a number.";
