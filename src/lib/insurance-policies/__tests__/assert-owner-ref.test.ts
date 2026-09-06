/**
 * A life-insurance policy's owner arrives as a request-body id and is written
 * straight into `account_owners`. The DB foreign key proves the row exists
 * somewhere — not that it belongs to this client. Each ref kind must reach the
 * assert for its own table; a wrong-table routing is exactly the mistake that
 * would let a foreign id through, so every case pins its own call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-scoping", () => ({
  assertFamilyMembersInClient: vi.fn(),
  assertEntitiesInClient: vi.fn(),
  assertExternalBeneficiariesInClient: vi.fn(),
}));

import { assertOwnerRefInClient } from "../assert-owner-ref";
import {
  assertFamilyMembersInClient,
  assertEntitiesInClient,
  assertExternalBeneficiariesInClient,
} from "@/lib/db-scoping";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const FOREIGN = "99999999-9999-9999-9999-999999999999";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertFamilyMembersInClient).mockResolvedValue({ ok: true });
  vi.mocked(assertEntitiesInClient).mockResolvedValue({ ok: true });
  vi.mocked(assertExternalBeneficiariesInClient).mockResolvedValue({ ok: true });
});

describe("assertOwnerRefInClient", () => {
  it("refuses an entity that belongs to another client", async () => {
    vi.mocked(assertEntitiesInClient).mockResolvedValue({
      ok: false,
      reason: "Entity not in this client",
    });
    const r = await assertOwnerRefInClient(CLIENT, { kind: "entity", id: FOREIGN });
    expect(r.ok).toBe(false);
  });

  it("refuses a family member that belongs to another client", async () => {
    vi.mocked(assertFamilyMembersInClient).mockResolvedValue({
      ok: false,
      reason: "Family member not in this client",
    });
    const r = await assertOwnerRefInClient(CLIENT, { kind: "family", id: FOREIGN });
    expect(r.ok).toBe(false);
  });

  it("refuses an external beneficiary that belongs to another client", async () => {
    vi.mocked(assertExternalBeneficiariesInClient).mockResolvedValue({
      ok: false,
      reason: "External beneficiary not in this client",
    });
    const r = await assertOwnerRefInClient(CLIENT, { kind: "external", id: FOREIGN });
    expect(r.ok).toBe(false);
  });

  it("checks each ref kind against its OWN table, scoped to this client", async () => {
    await assertOwnerRefInClient(CLIENT, { kind: "family", id: FOREIGN });
    expect(assertFamilyMembersInClient).toHaveBeenCalledWith(CLIENT, [FOREIGN]);
    expect(assertEntitiesInClient).not.toHaveBeenCalled();
    expect(assertExternalBeneficiariesInClient).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(assertEntitiesInClient).mockResolvedValue({ ok: true });
    await assertOwnerRefInClient(CLIENT, { kind: "entity", id: FOREIGN });
    expect(assertEntitiesInClient).toHaveBeenCalledWith(CLIENT, [FOREIGN]);
    expect(assertFamilyMembersInClient).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(assertExternalBeneficiariesInClient).mockResolvedValue({ ok: true });
    await assertOwnerRefInClient(CLIENT, { kind: "external", id: FOREIGN });
    expect(assertExternalBeneficiariesInClient).toHaveBeenCalledWith(CLIENT, [FOREIGN]);
    expect(assertEntitiesInClient).not.toHaveBeenCalled();
  });

  it("passes `joint` through — it carries no id, the owners are derived server-side", async () => {
    const r = await assertOwnerRefInClient(CLIENT, { kind: "joint" });
    expect(r.ok).toBe(true);
    expect(assertFamilyMembersInClient).not.toHaveBeenCalled();
    expect(assertEntitiesInClient).not.toHaveBeenCalled();
    expect(assertExternalBeneficiariesInClient).not.toHaveBeenCalled();
  });
});
