import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { Principal } from "@/lib/clients/authz";

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
let ecKeys: KeyPair;

/** Second key id, published in the same key set but with an EC key behind it. */
const EC_KID = "ins_elliptic_curve_key";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
  clerkKeys = await generateKeyPair("RS256", { extractable: true });
  attackerKeys = await generateKeyPair("RS256", { extractable: true });
  ecKeys = await generateKeyPair("ES256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(clerkKeys.publicKey)), kid: KID, alg: "RS256" };
  // A second, legitimately-published key on a different algorithm. Without an
  // `algorithms` pin a token signed with it verifies fine — which is the point
  // of the algorithm-pin test below.
  const ecJwk: JWK = { ...(await exportJWK(ecKeys.publicKey)), kid: EC_KID, alg: "ES256" };
  h.jwks = createLocalJWKSet({ keys: [jwk, ecJwk] });
});

/**
 * Task 12 fix round 1 / F1 trap: this used to be a book-scoped STAFF role
 * (`org:operations`), which the F1 gate now blocks — every test that relied
 * on this default resolving successfully would otherwise go red for the
 * wrong reason. `org:member` is a firm-wide role F1 never touches.
 * `is_founder: true` similarly keeps F2's billing gate out of every test
 * that isn't specifically about billing: without SOME public metadata the
 * org reads as `{kind: "missing"}`, which F2 blocks unconditionally
 * regardless of enforcement mode.
 */
const DEFAULT_MEMBERSHIP = {
  role: "org:member",
  organization: { id: ORG_ID, publicMetadata: { is_founder: true } },
};

beforeEach(() => {
  h.jwksUrls.length = 0;
  h.getOrganizationMembershipList.mockReset();
  h.getOrganizationMembershipList.mockResolvedValue({
    data: [DEFAULT_MEMBERSHIP],
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
  alg?: string;
  kid?: string;
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
    .setProtectedHeader({ alg: o.alg ?? "RS256", kid: o.kid ?? KID, typ: o.typ ?? "at+jwt" })
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
      orgRole: "org:member",
      scopes: ["profile", "email", "user:org:read", "offline_access"],
      tokenSubject: USER_ID,
    });
  });

  it("stays assignable to Principal with a non-nullable orgRole", async () => {
    const principal = await resolveMcpPrincipal(await mintToken());
    // Two compile-time claims; the RED for both is `tsc`, not vitest.
    // 1. orgRole is narrowed to `string` — this line errors if it widens back
    //    to `string | null` under strictNullChecks.
    const role: string = principal.orgRole;
    // 2. Narrowing must not break the hand-off to verifyClientAccessFor, which
    //    takes the wider `Principal`.
    const asPrincipal: Principal = principal;
    expect(role).toBe("org:member");
    expect(asPrincipal.orgId).toBe(ORG_ID);
  });

  it("returns no scopes when the token carries no scope claim", async () => {
    await expect(resolveMcpPrincipal(await mintToken({ scope: null }))).resolves.toMatchObject({
      scopes: [],
    });
  });

  it("rejects a token signed by a key that is not Clerk's", async () => {
    await expect(
      resolveMcpPrincipal(await mintToken({ signWith: attackerKeys })),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it("F7 (Ruling R79): logs the underlying jose failure server-side, without changing the caller-facing message", async () => {
    // Without this log line, a Clerk JWKS outage is byte-identical, in the
    // server log AND the response, to an ordinary bad token — R79's finding.
    // The thrown message must stay exactly "token failed verification" (its
    // deliberate opacity is unrelated to this fix); only the log is new.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejection = resolveMcpPrincipal(await mintToken({ signWith: attackerKeys }));
    await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
    await expect(rejection).rejects.toThrow(/^token failed verification$/);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "MCP: token verification failed",
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
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

  it("rejects a token signed with a published key on another algorithm", async () => {
    // EC_KID really is in the key set and the signature really is valid, so
    // only the `algorithms: ["RS256"]` pin can reject this one.
    const token = await mintToken({ alg: "ES256", kid: EC_KID, signWith: ecKeys });
    await expect(resolveMcpPrincipal(token)).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it("rejects an expired token", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    await expect(
      resolveMcpPrincipal(await mintToken({ expiresAt: expiredAt })),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it("rejects a verified token that carries no subject", async () => {
    await expect(resolveMcpPrincipal(await mintToken({ sub: null }))).rejects.toThrow(
      /no subject/i,
    );
    // Rejected before Clerk is consulted. A principal with a blank userId and a
    // real orgRole would reach resolveVisibleAdvisorIds("", "org:admin", firm)
    // and come back VISIBLE_ALL — firm-wide read with nobody attributable.
    expect(h.getOrganizationMembershipList).not.toHaveBeenCalled();
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
    const rejection = resolveMcpPrincipal(await mintToken());
    await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
    // Pin WHICH guard fired. A valid token with a present org has no other
    // rejecter today, but nothing locks that in without this.
    await expect(rejection).rejects.toThrow(/not a member/i);
  });

  it("takes orgRole from the live membership, never from the token", async () => {
    // Task 12 fix round 1 / F1 trap: this test used to prove the point with
    // `org:planner`, a book-scoped STAFF role — which the F1 gate below now
    // blocks, so it can no longer also stand for "the connector accepts this
    // role." `org:admin` isolates the "forged claim does not win" property
    // from F1 entirely; the analogous staff-role case is its own dedicated
    // denial test below.
    h.getOrganizationMembershipList.mockResolvedValue({
      data: [{ role: "org:admin", organization: { id: ORG_ID, publicMetadata: { is_founder: true } } }],
      totalCount: 1,
    });
    // A forged role claim in the token must not win — real tokens carry none.
    const token = await mintToken({ extra: { org_role: "org:member" } });
    await expect(resolveMcpPrincipal(token)).resolves.toMatchObject({ orgRole: "org:admin" });
    expect(h.getOrganizationMembershipList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  describe("F1 — book-scoped staff roles are blocked from the connector (Rulings R82/R83)", () => {
    it("denies a token whose live membership role is org:operations", async () => {
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [{ role: "org:operations", organization: { id: ORG_ID, publicMetadata: { is_founder: true } } }],
        totalCount: 1,
      });
      const rejection = resolveMcpPrincipal(await mintToken());
      await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
      // Pins WHICH guard fired, and proves the block runs AFTER the live
      // membership resolves (R82) — a message about billing or "not a
      // member" would also satisfy `rejects.toBeInstanceOf` but would be the
      // WRONG guard.
      await expect(rejection).rejects.toThrow(/cannot use the foundry connector/i);
    });

    it("denies a token whose live membership role is org:planner", async () => {
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [{ role: "org:planner", organization: { id: ORG_ID, publicMetadata: { is_founder: true } } }],
        totalCount: 1,
      });
      const rejection = resolveMcpPrincipal(await mintToken());
      await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
      await expect(rejection).rejects.toThrow(/cannot use the foundry connector/i);
    });

    it("does NOT block a live custom advisor role absent from ROLE_CAPABILITIES", async () => {
      // The regression this guards: the reviewer's originally-proposed fix
      // was `roleHasCapability(orgRole, <planning cap>)`, which is
      // deny-by-default (capabilities.ts). `org:senior_advisor` is a real,
      // firm-wide advisor role with NO entry in ROLE_CAPABILITIES (only
      // src/app/api/advisors/route.ts's STAFF_ROLES denylist recognizes it
      // as advisor-eligible) — so a capability-based gate here would 401 a
      // legitimate advisor. Using STAFF_ROLES.has() instead must let it
      // through.
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [
          { role: "org:senior_advisor", organization: { id: ORG_ID, publicMetadata: { is_founder: true } } },
        ],
        totalCount: 1,
      });
      await expect(resolveMcpPrincipal(await mintToken())).resolves.toMatchObject({
        orgRole: "org:senior_advisor",
      });
    });
  });

  describe("F2 — a billing lockout reaches the connector too (Rulings R84/R85)", () => {
    const ORIGINAL_MODE = process.env.BILLING_ENFORCEMENT_MODE;

    afterEach(() => {
      if (ORIGINAL_MODE === undefined) delete process.env.BILLING_ENFORCEMENT_MODE;
      else process.env.BILLING_ENFORCEMENT_MODE = ORIGINAL_MODE;
    });

    it("denies a token whose org carries no billing metadata at all, in default (log) mode", async () => {
      // stateFromMeta({}) / stateFromMeta(undefined) => {kind: "missing"},
      // which access-policy.ts documents as blocking UNCONDITIONALLY,
      // independent of BILLING_ENFORCEMENT_MODE — mirrors src/proxy.ts.
      delete process.env.BILLING_ENFORCEMENT_MODE;
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [{ role: "org:member", organization: { id: ORG_ID, publicMetadata: {} } }],
        totalCount: 1,
      });
      const rejection = resolveMcpPrincipal(await mintToken());
      await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
      await expect(rejection).rejects.toThrow(/subscription is inactive/i);
    });

    it("does NOT deny a terminal billing state while enforcement mode is 'log' (today's shipped mode)", async () => {
      process.env.BILLING_ENFORCEMENT_MODE = "log";
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [
          { role: "org:member", organization: { id: ORG_ID, publicMetadata: { subscription_status: "unpaid" } } },
        ],
        totalCount: 1,
      });
      await expect(resolveMcpPrincipal(await mintToken())).resolves.toMatchObject({ orgRole: "org:member" });
    });

    it("denies the same terminal billing state once enforcement mode flips to 'enforce'", async () => {
      process.env.BILLING_ENFORCEMENT_MODE = "enforce";
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [
          { role: "org:member", organization: { id: ORG_ID, publicMetadata: { subscription_status: "unpaid" } } },
        ],
        totalCount: 1,
      });
      const rejection = resolveMcpPrincipal(await mintToken());
      await expect(rejection).rejects.toBeInstanceOf(McpUnauthorizedError);
      await expect(rejection).rejects.toThrow(/subscription is inactive/i);
    });

    it("does NOT deny a grace-period (read-only-on-mutation) state even in 'enforce' mode — GET, not POST (R84)", async () => {
      // canceled_grace only degrades to block_mutation for a MUTATING method;
      // decideAccess(state, "GET", ...) returns "allow". If F2 mistakenly
      // evaluated "POST" here, this would incorrectly lock out a
      // read-only connector call the web itself still permits.
      process.env.BILLING_ENFORCEMENT_MODE = "enforce";
      const archivedAt = new Date().toISOString();
      h.getOrganizationMembershipList.mockResolvedValue({
        data: [
          {
            role: "org:member",
            organization: {
              id: ORG_ID,
              publicMetadata: { subscription_status: "canceled", archived_at: archivedAt },
            },
          },
        ],
        totalCount: 1,
      });
      await expect(resolveMcpPrincipal(await mintToken())).resolves.toMatchObject({ orgRole: "org:member" });
    });
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
        data: [{ role: "org:admin", organization: { id: ORG_ID, publicMetadata: { is_founder: true } } }],
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
    // The stride must be the page size exactly. `toBeGreaterThan(0)` would also
    // pass for `offset: page * 50`, which silently skips records 50-99 and
    // locks out an advisor whose membership sits in the skipped band.
    expect(calls[1][0].offset).toBe(calls[0][0].limit);
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

describe("MCP_RESOURCE_URL (F5)", () => {
  // Evaluated once at module import, so pinning either branch needs a fresh
  // import — same pattern as "derives the pinned issuer..." above. Restored
  // with `delete` when the captured value was undefined, never by assigning
  // it (R24) — assigning would set the literal string "undefined".
  it("falls back to the prod origin when NEXT_PUBLIC_APP_URL is unset", async () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.resetModules();
    try {
      const fresh = await import("../principal");
      expect(fresh.MCP_RESOURCE_URL).toBe("https://app.foundryplanning.com/api/mcp");
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    }
  });

  it("uses NEXT_PUBLIC_APP_URL when it is set", async () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com";
    vi.resetModules();
    try {
      const fresh = await import("../principal");
      expect(fresh.MCP_RESOURCE_URL).toBe("https://staging.example.com/api/mcp");
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    }
  });
});
