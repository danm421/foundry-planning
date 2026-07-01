import type { ForgeAuthContext, ForgeGlobalAuthContext } from "../state";

/** Fixed, fake scope for offline evals — never hits Clerk/DB. */
export const EVAL_AUTH: ForgeAuthContext = {
  userId: "user_eval",
  firmId: "org_eval",
  clientId: "client_eval",
  scenarioId: "base",
};

/** Fixed, fake global (clientless) scope for global-mode evals. */
export const EVAL_AUTH_GLOBAL: ForgeGlobalAuthContext = {
  userId: "user_eval",
  firmId: "org_eval",
};

/** A stable system prompt for evals — avoids loadPromptContext's DB reads. */
export const evalSystemPrompt = () =>
  "You are Forge, a financial-planning assistant. Use tools to answer. Never invent a number.";
