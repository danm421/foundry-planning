import { describe, it, expect, vi, beforeEach } from "vitest";

const { permanentRedirect } = vi.hoisted(() => ({
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ permanentRedirect }));

import ProfilePage from "../profile/page";
import FamilyPage from "../profile/family/page";
import TrustsPage from "../profile/trusts/page";
import AccountsPage from "../accounts/page";

describe("legacy portal routes redirect into Organizer", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["/portal/organizer", ProfilePage],
    ["/portal/organizer#family", FamilyPage],
    ["/portal/organizer#trusts", TrustsPage],
    ["/portal/organizer/accounts", AccountsPage],
  ])("redirects to %s", async (target, page) => {
    await expect(
      (page as () => Promise<unknown>)(),
    ).rejects.toThrow(`NEXT_REDIRECT:${target}`);
    expect(permanentRedirect).toHaveBeenCalledWith(target);
  });
});
