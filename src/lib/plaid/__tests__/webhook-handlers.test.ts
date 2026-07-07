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
vi.mock("../transactions-sync", () => ({ syncTransactionsForItem: vi.fn() }));
vi.mock("../refresh-item-data", () => ({ refreshPlaidItemData: vi.fn() }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordCreate: vi.fn() }));

import { plaidWebhookHandlers } from "../webhook-handlers";
import { syncTransactionsForItem } from "../transactions-sync";
import { refreshPlaidItemData } from "../refresh-item-data";
import { recordCreate } from "@/lib/audit/record-helpers";

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
  vi.mocked(syncTransactionsForItem).mockReset();
  vi.mocked(refreshPlaidItemData).mockReset();
  vi.mocked(recordCreate).mockReset();
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

describe("data handlers", () => {
  // findItem resolves ITEM_ROW; a second select resolves firmId for audits.
  // Arrange dbSelect per-test with a sequence, as in the reauth-complete tests.
  // Alternates ITEM_ROW / firmId-row by call parity so it holds across
  // multiple handler invocations in a single test (findItem, audit, findItem, audit, ...).
  function withFirmSelect(firmId = "firm-1") {
    let n = 0;
    dbSelect.mockImplementation(() => {
      const isFirmCall = n % 2 === 1;
      n++;
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(isFirmCall ? [{ firmId }] : [ITEM_ROW]) }),
        }),
      };
    });
  }

  it("SYNC_UPDATES_AVAILABLE runs the sync and audits as system", async () => {
    withFirmSelect();
    vi.mocked(syncTransactionsForItem).mockResolvedValue({ ok: true, added: 3, modified: 1, removed: 0 });
    const r = await plaidWebhookHandlers["TRANSACTIONS:SYNC_UPDATES_AVAILABLE"](base);
    expect(r).toBe("ok");
    expect(syncTransactionsForItem).toHaveBeenCalledWith(ITEM_ROW);
    expect(recordCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: "webhook.plaid.sync",
      actorKind: "system",
      clientId: "client-1",
    }));
  });

  it("sync failure with a re-auth code persists it and returns ok", async () => {
    vi.mocked(syncTransactionsForItem).mockResolvedValue({
      ok: false, errorCode: "ITEM_LOGIN_REQUIRED", errorMessage: "login required",
    });
    const r = await plaidWebhookHandlers["TRANSACTIONS:SYNC_UPDATES_AVAILABLE"](base);
    expect(r).toBe("ok");
    expect(dbSetArgs).toContainEqual({ lastRefreshError: "ITEM_LOGIN_REQUIRED" });
    expect(recordCreate).not.toHaveBeenCalled();
  });

  it("sync failure with a transient code throws (Plaid should retry)", async () => {
    vi.mocked(syncTransactionsForItem).mockResolvedValue({
      ok: false, errorCode: "INTERNAL_SERVER_ERROR", errorMessage: "oops",
    });
    await expect(plaidWebhookHandlers["TRANSACTIONS:SYNC_UPDATES_AVAILABLE"](base)).rejects.toThrow();
  });

  it("HOLDINGS/LIABILITIES DEFAULT_UPDATE run the shared item refresh", async () => {
    withFirmSelect();
    vi.mocked(refreshPlaidItemData).mockResolvedValue({
      ok: true, accountsRefreshed: 2, beforeTotal: "10.00", afterTotal: "11.00",
    });
    expect(await plaidWebhookHandlers["HOLDINGS:DEFAULT_UPDATE"](base)).toBe("ok");
    expect(await plaidWebhookHandlers["LIABILITIES:DEFAULT_UPDATE"](base)).toBe("ok");
    expect(refreshPlaidItemData).toHaveBeenCalledTimes(2);
    expect(recordCreate).toHaveBeenCalledWith(expect.objectContaining({ action: "webhook.plaid.refresh" }));
  });

  it("refresh needsReauth=true returns ok without audit; transient throws", async () => {
    vi.mocked(refreshPlaidItemData).mockResolvedValue({ ok: false, errorCode: "ITEM_LOGIN_REQUIRED", needsReauth: true });
    expect(await plaidWebhookHandlers["HOLDINGS:DEFAULT_UPDATE"](base)).toBe("ok");
    vi.mocked(refreshPlaidItemData).mockResolvedValue({ ok: false, errorCode: "INTERNAL_SERVER_ERROR", needsReauth: false });
    await expect(plaidWebhookHandlers["HOLDINGS:DEFAULT_UPDATE"](base)).rejects.toThrow();
  });

  it("legacy transactions codes are ignored", async () => {
    for (const code of ["INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE"]) {
      expect(await plaidWebhookHandlers[`TRANSACTIONS:${code}`](base)).toBe("ignored");
    }
  });
});
