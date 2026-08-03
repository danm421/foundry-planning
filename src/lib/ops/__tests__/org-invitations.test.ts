import { describe, it, expect } from "vitest";
import { buildInvitationRows } from "../org-invitations";

const NOW = Date.parse("2026-08-03T00:00:00Z");
const DAY = 86_400_000;

const INV = (over: Partial<Parameters<typeof buildInvitationRows>[0][number]> = {}) => ({
  id: "orginv_1",
  emailAddress: "advisor@example.com",
  role: "org:admin",
  roleName: "Admin",
  status: "pending",
  createdAt: NOW - DAY,
  expiresAt: NOW + DAY,
  ...over,
});

describe("buildInvitationRows", () => {
  it("maps a pending invitation onto a row", () => {
    expect(buildInvitationRows([INV()], NOW)).toEqual([
      {
        id: "orginv_1",
        email: "advisor@example.com",
        role: "Admin",
        status: "pending",
        createdAt: NOW - DAY,
        expiresAt: NOW + DAY,
      },
    ]);
  });

  it("re-labels a lapsed pending invitation as expired", () => {
    const [row] = buildInvitationRows([INV({ expiresAt: NOW - 1 })], NOW);
    expect(row.status).toBe("expired");
  });

  it("leaves a lapsed but already-accepted invitation alone", () => {
    const [row] = buildInvitationRows([INV({ status: "accepted", expiresAt: NOW - 1 })], NOW);
    expect(row.status).toBe("accepted");
  });

  it("keeps a pending invitation that has no expiry", () => {
    const [row] = buildInvitationRows([INV({ expiresAt: null })], NOW);
    expect(row).toMatchObject({ status: "pending", expiresAt: null });
  });

  it("falls back to the raw role key when Clerk sends no roleName", () => {
    const [row] = buildInvitationRows([INV({ roleName: undefined, role: "org:basic_member" })], NOW);
    expect(row.role).toBe("basic member");
  });

  it("sorts newest first", () => {
    const rows = buildInvitationRows(
      [
        INV({ id: "old", createdAt: NOW - 10 * DAY }),
        INV({ id: "new", createdAt: NOW - DAY }),
        INV({ id: "mid", createdAt: NOW - 5 * DAY }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });
});
