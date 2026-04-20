import { getAdvisorContextOrFallback } from '@foundry/auth';

export async function getCurrentFirmId(): Promise<string> {
  const ctx = await getAdvisorContextOrFallback();
  return ctx.firmId;
}
