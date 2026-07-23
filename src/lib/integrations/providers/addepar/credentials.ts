import { z } from "zod";

export type AddeparSecret = { apiKey: string; apiSecret: string };
export type AddeparConfig = { apiBase: string; addeparFirmId: string };

const secretSchema = z.object({ apiKey: z.string().min(1), apiSecret: z.string().min(1) });

/**
 * SSRF guard: apiBase must be an https URL on an addepar.com host. Prevents an
 * org-admin from pointing the outbound client fetch at internal/link-local
 * hosts (169.254.169.254, localhost, etc.). Firm-specific Addepar deployments
 * live under *.addepar.com, so subdomains are allowed; a truly custom host is a
 * deliberate future change gated on the ADDEPAR_ENABLED flip.
 */
export const addeparApiBaseSchema = z
  .string()
  .url()
  .refine((raw) => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "addepar.com" || h.endsWith(".addepar.com");
  }, { message: "apiBase must be an https:// URL on an addepar.com host" });

const configSchema = z.object({ apiBase: addeparApiBaseSchema, addeparFirmId: z.string().min(1) });

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
