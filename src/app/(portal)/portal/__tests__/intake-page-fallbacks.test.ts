import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The portal intake page has two "there is nothing to fill in" fallbacks. Both
 * must land on the Organizer directly: routing them through the retired
 * `/portal/profile` shim would cost a full page reload, because under the
 * portal's streaming boundary `permanentRedirect()` resolves as a
 * `<meta http-equiv="refresh">` inside a 200 rather than a 308 (see the sibling
 * organizer-redirects test and `(portal)/portal/profile/page.tsx`).
 *
 * vi.mock is hoisted above every `const` below, so the boxes the factories
 * close over come from vi.hoisted().
 */
const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  clientRows: [] as unknown[],
  loadOrSeed: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));
vi.mock("@/db/schema", () => ({
  clients: { id: "id", firmId: "firmId", advisorId: "advisorId" },
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => h.clientRows }) }),
    }),
  },
}));
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: async () => ({
    clientId: "client-1",
    clerkUserId: "user-1",
  }),
}));
vi.mock("@/lib/intake/load-or-seed", () => ({
  loadOrSeedPortalIntakeForm: (...a: unknown[]) => h.loadOrSeed(...a),
}));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveIntakeBrandingForClient: async () => null,
}));
vi.mock("../intake/intake-client", () => ({
  PortalIntakeClient: () => null,
}));

import PortalIntakePage from "../intake/page";

const CLIENT_ROW = { firmId: "firm-1", advisorId: "advisor-1" };
const FORM = {
  formId: "form-1",
  payload: { family: {} },
  status: "draft",
  recipientName: "Jane",
};

beforeEach(() => {
  h.redirect.mockClear();
  h.loadOrSeed.mockReset();
  h.clientRows = [CLIENT_ROW];
  h.loadOrSeed.mockResolvedValue(FORM);
});

describe("portal intake page fallbacks", () => {
  it("redirects to /portal/organizer when the clients row is gone", async () => {
    h.clientRows = [];
    await expect(PortalIntakePage()).rejects.toThrow(
      "NEXT_REDIRECT:/portal/organizer",
    );
    expect(h.redirect).toHaveBeenCalledWith("/portal/organizer");
    // The row is missing, so the seed must never have been attempted.
    expect(h.loadOrSeed).not.toHaveBeenCalled();
  });

  it("redirects to /portal/organizer when there is no active prefilled form", async () => {
    h.loadOrSeed.mockResolvedValue(null);
    await expect(PortalIntakePage()).rejects.toThrow(
      "NEXT_REDIRECT:/portal/organizer",
    );
    expect(h.redirect).toHaveBeenCalledWith("/portal/organizer");
  });

  // Discriminator: without this, a page that redirected unconditionally would
  // still satisfy both cases above.
  it("renders the wizard — and redirects nowhere — when a form exists", async () => {
    await expect(PortalIntakePage()).resolves.toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
