// src/lib/integrations/connections-byok.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { upsertByokConnection, getConnection } from "./connections";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("upsertByokConnection", () => {
  it("stores the secret encrypted and the config in scope, round-tripping via getConnection", async () => {
    await upsertByokConnection({
      firmId,
      providerId: "addepar",
      secretBlob: JSON.stringify({ apiKey: "k", apiSecret: "s" }),
      configBlob: JSON.stringify({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
      userId: "u1",
    });
    const conn = await getConnection(firmId, "addepar");
    expect(conn?.status).toBe("connected");
    expect(conn?.accessToken).toContain("apiKey");         // helper decrypts to the secret JSON
    expect(conn?.accessTokenEnc).not.toContain("apiKey");  // raw column is ciphertext
    expect(conn?.scope).toContain("addeparFirmId");         // config lives in scope
  });
});
