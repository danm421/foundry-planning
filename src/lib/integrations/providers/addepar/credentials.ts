import { z } from "zod";

export type AddeparSecret = { apiKey: string; apiSecret: string };
export type AddeparConfig = { apiBase: string; addeparFirmId: string };

const secretSchema = z.object({ apiKey: z.string().min(1), apiSecret: z.string().min(1) });
const configSchema = z.object({ apiBase: z.string().url(), addeparFirmId: z.string().min(1) });

export function encodeAddeparSecret(s: AddeparSecret): string {
  return JSON.stringify(secretSchema.parse(s));
}

export function decodeAddeparSecret(raw: string): AddeparSecret {
  return secretSchema.parse(JSON.parse(raw));
}

export function encodeAddeparConfig(c: AddeparConfig): string {
  return JSON.stringify(configSchema.parse(c));
}

export function decodeAddeparConfig(raw: string | null): AddeparConfig {
  if (!raw) throw new Error("addepar config missing");
  return configSchema.parse(JSON.parse(raw));
}
