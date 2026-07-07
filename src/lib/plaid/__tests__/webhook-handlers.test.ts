import { beforeEach, describe, expect, it, vi } from "vitest";

const dbSelect = vi.fn();
const dbSetArgs: unknown[] = [];
const dbUpdate = vi.fn().mockReturnValue({
  set: (arg: unknown) => {
    dbSetArgs.push(arg);
    return { where: vi.fn().mockResolvedValue(undefined) };
  },
});
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));
// NOTE: data-handler deps (transactions-sync, refresh-item-data,
// record-helpers) are NOT imported by webhook-handlers.ts until Task 7 —
// their vi.mock lines are added in Task 7, not here.

import { plaidWebhookHandlers } from "../webhook-handlers";

const ITEM_ROW = {
  id: "row-1",
  clientId: "client-1",
  accessToken: "enc",
  transactionsCursor: null,
};

beforeEach(() => {
  dbSelect.mockReset();
  dbUpdate.mockClear();
  dbSetArgs.length = 0;
  dbSelect.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([ITEM_ROW]) }) }),
  }));
});

const base = { item_id: "plaid-item-1", environment: "production" };

describe("ITEM status handlers", () => {
  it("ITEM:ERROR writes the payload error code", async () => {
    const r = await plaidWebhookHandlers["ITEM:ERROR"]({
      ...base, webhook_type: "ITEM", webhook_code: "ERROR",
      error: { error_code: "ITEM_LOGIN_REQUIRED" },
    });
    expect(r).toBe("ok");
    expect(dbSetArgs[0]).toEqual({ lastRefreshError: "ITEM_LOGIN_REQUIRED" });
  });

  it("ITEM:ERROR without an error code is ignored", async () => {
    const r = await plaidWebhookHandlers["ITEM:ERROR"]({ ...base, error: null });
    expect(r).toBe("ignored");
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("ITEM:PENDING_EXPIRATION / PENDING_DISCONNECT write their codes", async () => {
    await plaidWebhookHandlers["ITEM:PENDING_EXPIRATION"](base);
    await plaidWebhookHandlers["ITEM:PENDING_DISCONNECT"](base);
    expect(dbSetArgs).toEqual([
      { lastRefreshError: "PENDING_EXPIRATION" },
      { lastRefreshError: "PENDING_DISCONNECT" },
    ]);
  });

  it("ITEM:LOGIN_REPAIRED clears the error", async () => {
    const r = await plaidWebhookHandlers["ITEM:LOGIN_REPAIRED"](base);
    expect(r).toBe("ok");
    expect(dbSetArgs[0]).toEqual({ lastRefreshError: null });
  });

  it("revocation codes write through", async () => {
    await plaidWebhookHandlers["ITEM:USER_PERMISSION_REVOKED"](base);
    await plaidWebhookHandlers["ITEM:USER_ACCOUNT_REVOKED"](base);
    expect(dbSetArgs).toEqual([
      { lastRefreshError: "USER_PERMISSION_REVOKED" },
      { lastRefreshError: "USER_ACCOUNT_REVOKED" },
    ]);
  });

  it("ITEM:NEW_ACCOUNTS_AVAILABLE stamps the timestamp", async () => {
    const r = await plaidWebhookHandlers["ITEM:NEW_ACCOUNTS_AVAILABLE"](base);
    expect(r).toBe("ok");
    const arg = dbSetArgs[0] as { newAccountsAvailableAt: unknown };
    expect(arg.newAccountsAvailableAt).toBeInstanceOf(Date);
  });

  it("WEBHOOK_UPDATE_ACKNOWLEDGED is ignored", async () => {
    expect(await plaidWebhookHandlers["ITEM:WEBHOOK_UPDATE_ACKNOWLEDGED"](base)).toBe("ignored");
  });

  it("unknown item_id is ignored, not an error", async () => {
    dbSelect.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }));
    expect(await plaidWebhookHandlers["ITEM:PENDING_EXPIRATION"](base)).toBe("ignored");
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("missing item_id is ignored", async () => {
    expect(await plaidWebhookHandlers["ITEM:PENDING_EXPIRATION"]({})).toBe("ignored");
  });
});
