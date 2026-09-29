import { inspect } from "node:util";
import { Client } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { redactSecrets, safeErrorFields, scrubSecrets } from "../secrets";

// A throwaway credential, never a real one.
const PASSWORD = "npg_TESTONLYsecret";
const HOST = "ep-test-pooler.us-east-1.aws.neon.tech";
const URL_WITH_PASSWORD = `postgresql://neondb_owner:${PASSWORD}@${HOST}/neondb`;

describe("safeErrorFields", () => {
  it("keeps name, message, code and stack but drops the attached driver client", () => {
    const client = new Client({ connectionString: URL_WITH_PASSWORD });
    const err = Object.assign(new Error("Connection terminated unexpectedly"), {
      client,
      code: "57P01",
    });

    const fields = safeErrorFields(err);

    expect(Object.keys(fields).sort()).toEqual(["code", "message", "name", "stack"]);
    expect(fields).toMatchObject({
      name: "Error",
      message: "Connection terminated unexpectedly",
      code: "57P01",
    });
    expect(inspect(fields, { depth: null })).not.toContain(PASSWORD);
  });

  it("scrubs a password URL out of the message and the stack", () => {
    const fields = safeErrorFields(new Error(`could not connect to ${URL_WITH_PASSWORD}`));

    expect(fields.message).toBe(
      `could not connect to postgresql://neondb_owner:[REDACTED]@${HOST}/neondb`,
    );
    expect(fields.stack).not.toContain(PASSWORD);
  });

  it("never serializes a non-Error throw's contents", () => {
    expect(safeErrorFields({ connectionString: URL_WITH_PASSWORD })).toEqual({
      name: "NonError",
      message: "[object Object]",
    });
    expect(safeErrorFields("boom")).toEqual({ name: "NonError", message: "boom" });
  });
});

describe("redactSecrets", () => {
  it("masks the password in a postgres URL and keeps the user and host", () => {
    expect(redactSecrets(`url=${URL_WITH_PASSWORD} ok`)).toBe(
      `url=postgresql://neondb_owner:[REDACTED]@${HOST}/neondb ok`,
    );
    expect(redactSecrets(`postgres://u:${PASSWORD}@h/db`)).toBe("postgres://u:[REDACTED]@h/db");
  });

  it("masks URL credentials for any scheme", () => {
    expect(redactSecrets("rediss://default:tok3n@us1.upstash.io:6379")).toBe(
      "rediss://default:[REDACTED]@us1.upstash.io:6379",
    );
  });

  it("leaves URLs without a password alone", () => {
    for (const text of [
      `postgresql://${HOST}/neondb`,
      "https://user@example.com/path",
      "see https://example.com:8443/a@b",
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

describe("scrubSecrets", () => {
  it("scrubs URL passwords and password-named keys at any depth of a Sentry event", () => {
    const scope = new (class Scope {
      tag = URL_WITH_PASSWORD;
    })();
    const event = {
      exception: { values: [{ value: `boom ${URL_WITH_PASSWORD}` }] },
      breadcrumbs: [
        { message: "console", data: { arguments: [{ client: { config: { connectionString: URL_WITH_PASSWORD } } }] } },
      ],
      extra: { frameVars: { password: PASSWORD, port: 5432 } },
      sdkProcessingMetadata: { capturedSpanScope: scope },
    };

    const scrubbed = scrubSecrets(event);

    expect(JSON.stringify({ ...scrubbed, sdkProcessingMetadata: undefined })).not.toContain(PASSWORD);
    expect(scrubbed.exception.values[0].value).toBe(
      `boom postgresql://neondb_owner:[REDACTED]@${HOST}/neondb`,
    );
    expect(scrubbed.extra.frameVars).toEqual({ password: "[REDACTED]", port: 5432 });
    // SDK internals ride along on the event; a class instance is passed through, not rebuilt.
    expect(scrubbed.sdkProcessingMetadata.capturedSpanScope).toBe(scope);
  });
});
