/**
 * Resolves the webhook URL Plaid should deliver to. PLAID_WEBHOOK_URL wins
 * when set (Plaid accepts any URL — no dashboard registration — so this lets
 * sandbox items target a preview deployment or tunnel for E2E testing). In
 * production it derives from the app URL, matching oauthRedirectUri() in the
 * link-token route. Otherwise undefined: link tokens omit the webhook field,
 * which is exactly today's behavior.
 */
export function plaidWebhookUrl(): string | undefined {
  const override = process.env.PLAID_WEBHOOK_URL;
  if (override) return override;
  if (process.env.VERCEL_ENV !== "production") return undefined;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
  return `${appUrl}/api/webhooks/plaid`;
}
