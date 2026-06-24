// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const listMock = vi.fn();
vi.mock("@/components/portal/transactions-list", () => ({ default: (p: unknown): any => { listMock(p); return null; } }));
vi.mock("@/components/portal/categories-manager", () => ({ default: () => null }));

let clientRow: any;
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(clientRow ? [clientRow] : []) }) }) }) },
}));
vi.mock("@/db/schema", () => ({ clients: { _name: "clients" } }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

import TransactionsSection from "@/components/portal/transactions-section";

beforeEach(() => { listMock.mockReset(); });

describe("TransactionsSection", () => {
  it("passes editEnabled=true when the client has portal editing on", async () => {
    clientRow = { portalEditEnabled: true };
    render(await TransactionsSection({ clientId: "c1" }));
    expect(screen.getByText("Transactions")).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", editEnabled: true }));
  });

  it("passes editEnabled=false when portal editing is off", async () => {
    clientRow = { portalEditEnabled: false };
    render(await TransactionsSection({ clientId: "c1" }));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ editEnabled: false }));
  });

  it("defaults editEnabled=false when the client row is missing", async () => {
    clientRow = null;
    render(await TransactionsSection({ clientId: "c1" }));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ editEnabled: false }));
  });
});
