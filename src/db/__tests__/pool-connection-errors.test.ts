import { format, inspect } from "node:util";
import { Client } from "@neondatabase/serverless";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";

// A throwaway credential, never a real one — the test proves it can't reach a log line.
const PASSWORD = "npg_TESTONLYsecret";
const URL_WITH_PASSWORD = `postgresql://neondb_owner:${PASSWORD}@ep-test-pooler.us-east-1.aws.neon.tech/neondb`;

/** What the driver emits when Neon drops a connection. For an idle one,
 *  pg-pool also pins the real driver client — `connectionParameters`, and the
 *  raw `config` holding the connection string — onto the error as `err.client`. */
function droppedConnection() {
  const client = new Client({ connectionString: URL_WITH_PASSWORD });
  const err = Object.assign(new Error("Connection terminated unexpectedly"), { client });
  return { err, client };
}

function printed(logged: { mock: { calls: unknown[][] } }): string {
  return logged.mock.calls.map((args) => format(...args)).join("\n");
}

describe("db pool — dropped connections", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fixture: printing the raw error prints the password", () => {
    const { err } = droppedConnection();
    expect(err.client).toHaveProperty("connectionParameters");
    expect(inspect(err)).toContain(PASSWORD);
  });

  it("an idle connection's error, re-emitted by the pool, is not rethrown", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { err, client } = droppedConnection();

    // Unhandled, the pool rethrows it and the runtime prints the whole object.
    expect(() => db.$client.emit("error", err, client)).not.toThrow();
    expect(printed(logged)).not.toContain(PASSWORD);
  });

  it("any connection's error (idle or mid-transaction) is logged without the connection string", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { err, client } = droppedConnection();

    // The pool announces each new connection; a checked-out one has no other
    // `error` listener, so without ours the client itself would rethrow.
    db.$client.emit("connect", client);
    expect(() => client.emit("error", err)).not.toThrow();

    expect(printed(logged)).toContain("Connection terminated unexpectedly");
    expect(printed(logged)).not.toContain(PASSWORD);
  });
});
