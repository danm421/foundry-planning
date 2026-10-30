import { describe, it, expect, vi, afterEach } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { isImpersonating } from "./impersonation";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

type AuthResult = Awaited<ReturnType<typeof auth>>;

describe("isImpersonating", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("an ops 'sign in as' session (an actor claim) is impersonating", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_advisor", actor: { sub: "user_ops" } } as unknown as AuthResult);
    expect(await isImpersonating()).toBe(true);
  });

  it.each([undefined, null])("the advisor's own session (actor %s) is not", async (actor) => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_advisor", actor } as unknown as AuthResult);
    expect(await isImpersonating()).toBe(false);
  });
});
