import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";

/**
 * The verifier itself is NOT mocked. `jose.jwtVerify` runs for real against a
 * real RS256 keypair generated here; only `createRemoteJWKSet` is swapped for a
 * LOCAL key set so no network call reaches Clerk. That way the signature check,
 * the issuer pin and the `typ` pin are each exercised by production code — a
 * mocked `jwtVerify` would make all three vacuous.
 */
const h = vi.hoisted(() => ({
  jwks: null as null | ReturnType<typeof createLocalJWKSet>,
  jwksUrls: [] as string[],
  getOrganizationMembershipList: vi.fn(),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: (url: URL) => {
      h.jwksUrls.push(url.toString());
      if (!h.jwks) throw new Error("test key set not initialised");
      return h.jwks;
    },
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getOrganizationMembershipList: h.getOrganizationMembershipList },
  }),
}));

import { McpUnauthorizedError, resolveMcpPrincipal } from "../principal";

// The dev instance the Phase 0 spike ran against. `pk_test_` body is
// base64("assuring-monkfish-94.clerk.accounts.dev$").
const PUBLISHABLE_KEY = "pk_test_YXNzdXJpbmctbW9ua2Zpc2gtOTQuY2xlcmsuYWNjb3VudHMuZGV2JA";
const ISSUER = "https://assuring-monkfish-94.clerk.accounts.dev";
const USER_ID = "user_3JL11RLiKzZBVP2jNXgW1GmM0el";
const ORG_ID = "org_3JL0ojAeQgaTUQXnzY0VsqC7COO";
const KID = "ins_3CNCTqYj2IJDyxXfnToclorCi7K";
const SCOPE = "profile email user:org:read offline_access";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let clerkKeys: KeyPair;
let attackerKeys: KeyPair;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
  clerkKeys = await generateKeyPair("RS256", { extractable: true });
  attackerKeys = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(clerkKeys.publicKey)), kid: KID, alg: "RS256" };
  h.jwks = createLocalJWKSet({ keys: [jwk] });
});

beforeEach(() => {
  h.jwksUrls.length = 0;
  h.getOrganizationMembershipList.mockReset();
  h.getOrganizationMembershipList.mockResolvedValue({
    data: [{ role: "org:operations", organization: { id: ORG_ID } }],
    totalCount: 1,
  });
});

type MintOptions = {
  /** `null` omits `sub` entirely. */
  sub?: string | null;
  /** `null` omits `org_id` entirely — a user with no active organization. */
  orgId?: string | null;
  /** `null` omits `scope` entirely. */
  scope?: string | null;
  issuer?: string;
  typ?: string;
  /** Absolute unix seconds. */
  expiresAt?: number;
  signWith?: KeyPair;
  extra?: Record<string, unknown>;
};

async function mintToken(o: MintOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // The complete claim set a real Clerk OAuth access token carries (Q1 of the
  // Phase 0 spike): client_id, exp, iat, iss, jti, nbf, org_id, scope, sub.
  const payload: Record<string, unknown> = {
    client_id: "M9NpdFrml5CuYHwW",
    jti: "oat_72EKJWP5V50YKPWF",
    ...o.extra,
  };
  if (o.orgId !== null) payload.org_id = o.orgId ?? ORG_ID;
  if (o.scope !== null) payload.scope = o.scope ?? SCOPE;

  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: o.typ ?? "at+jwt" })
    .setIssuer(o.issuer ?? ISSUER)
    .setIssuedAt(now - 120)
    .setNotBefore(now - 120)
    .setExpirationTime(o.expiresAt ?? now + 3600);
  if (o.sub !== null) jwt = jwt.setSubject(o.sub ?? USER_ID);
  return jwt.sign((o.signWith ?? clerkKeys).privateKey);
}

describe("resolveMcpPrincipal", () => {
  it("resolves a verified token to a firm-scoped principal", async () => {
    await expect(resolveMcpPrincipal(await mintToken())).resolves.toEqual({
      userId: USER_ID,
      orgId: ORG_ID,
      orgRole: "org:operations",
      scopes: ["profile", "email", "user:org:read", "offline_access"],
      tokenSubject: USER_ID,
    });
  });

  it("rejects a token signed by a key that is not Clerk's", async () => {
    await expect(
      resolveMcpPrincipal(await mintToken({ signWith: attackerKeys })),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it("rejects a token issued by any issuer but our own Clerk instance", async () => {
    await expect(
      resolveMcpPrincipal(await mintToken({ issuer: "https://attacker.example.com" })),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it('rejects a session token (typ "JWT") presented as an OAuth access token', async () => {
    await expect(resolveMcpPrincipal(await mintToken({ typ: "JWT" }))).rejects.toBeInstanceOf(
      McpUnauthorizedError,
    );
  });

  it("rejects an expired token", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    await expect(
      resolveMcpPrincipal(await mintToken({ expiresAt: expiredAt })),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it("rejects a valid token that carries no organization", async () => {
    await expect(resolveMcpPrincipal(await mintToken({ orgId: null }))).rejects.toThrow(
      /has no organization/i,
    );
    // Rejected before Clerk is consulted at all. Without this assertion the
    // test passes even if the guard is deleted, because a blank org falls
    // through to the membership lookup and is rejected there — for a
    // different reason, by a message that also says "organization".
    expect(h.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  it("rejects a token whose org_id names an organization the user does not belong to", async () => {
    h.getOrganizationMembershipList.mockResolvedValue({
      data: [{ role: "org:admin", organization: { id: "org_someone_elses_firm" } }],
      totalCount: 1,
    });
    await expect(resolveMcpPrincipal(await mintToken())).rejects.toBeInstanceOf(
      McpUnauthorizedError,
    );
  });

  it("takes orgRole from the live membership, never from the token", async () => {
    h.getOrganizationMembershipList.mockResolvedValue({
      data: [{ role: "org:planner", organization: { id: ORG_ID } }],
      totalCount: 1,
    });
    // A forged role claim in the token must not win — real tokens carry none.
    const token = await mintToken({ extra: { org_role: "org:admin" } });
    await expect(resolveMcpPrincipal(token)).resolves.toMatchObject({ orgRole: "org:planner" });
    expect(h.getOrganizationMembershipList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it("rejects an empty bearer token up front", async () => {
    const rejection = resolveMcpPrincipal("");
    await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
    // The message pins WHICH guard fired. Without it the test passes even with
    // the guard deleted, because jose rejects an empty string anyway — so it
    // would assert nothing about this function.
    await expect(rejection).rejects.toThrow(/missing bearer token/i);
  });

  it("walks every page of the membership list rather than trusting the first", async () => {
    h.getOrganizationMembershipList.mockReset();
    h.getOrganizationMembershipList
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, i) => ({
          role: "org:member",
          organization: { id: `org_other_${i}` },
        })),
        totalCount: 101,
      })
      .mockResolvedValueOnce({
        data: [{ role: "org:admin", organization: { id: ORG_ID } }],
        totalCount: 101,
      });

    await expect(resolveMcpPrincipal(await mintToken())).resolves.toMatchObject({
      orgRole: "org:admin",
    });

    const calls = h.getOrganizationMembershipList.mock.calls as Array<
      [{ userId: string; limit: number; offset: number }]
    >;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ userId: USER_ID, offset: 0 });
    expect(typeof calls[0][0].limit).toBe("number");
    expect(calls[1][0].offset).toBeGreaterThan(0);
  });

  it("derives the pinned issuer and the JWKS url from the publishable key, once", async () => {
    const otherHost = "example-firm-77.clerk.accounts.dev";
    const otherIssuer = `https://${otherHost}`;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = `pk_live_${btoa(`${otherHost}$`)}`;
    vi.resetModules();
    h.jwksUrls.length = 0;
    try {
      const fresh = await import("../principal");

      await expect(
        fresh.resolveMcpPrincipal(await mintToken({ issuer: otherIssuer })),
      ).resolves.toMatchObject({ orgId: ORG_ID });
      // The instance we were pinned to a moment ago is now a foreign issuer.
      await expect(fresh.resolveMcpPrincipal(await mintToken())).rejects.toBeInstanceOf(
        fresh.McpUnauthorizedError,
      );

      // One entry, not two: the remote key set is built once and reused.
      expect(h.jwksUrls).toEqual([`${otherIssuer}/.well-known/jwks.json`]);
    } finally {
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
    }
  });

  it("fails closed when the publishable key is missing", async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    vi.resetModules();
    try {
      const fresh = await import("../principal");
      await expect(fresh.resolveMcpPrincipal(await mintToken())).rejects.toBeInstanceOf(
        fresh.McpUnauthorizedError,
      );
    } finally {
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
    }
  });
});
