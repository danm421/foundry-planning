import { it, expect, beforeEach, vi } from "vitest";
import type { AdvisorProfileRow } from "@/db/schema";
import { sendIntakeFormEmail } from "@/lib/intake/email";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";
import { requireClientEditAccess } from "@/lib/clients/authz";

vi.mock("@/lib/intake/email", () => ({ sendIntakeFormEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(async () => ({
    firstName: "Jane",
    lastName: "Advisor",
    primaryEmailAddress: { emailAddress: "jane@acme.com" },
  })),
  // Firm name is resolved live from the Clerk org (not session claims).
  clerkClient: vi.fn(async () => ({
    organizations: {
      getOrganization: vi.fn(async () => ({ name: "Acme Wealth" })),
    },
  })),
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgAndUser: vi.fn(async () => ({ orgId: "firm_1", userId: "user_1" })) }));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(async () => {}),
  authErrorResponse: vi.fn(() => null),
}));
vi.mock("@/lib/intake/tokens", () => ({ newIntakeToken: () => "tok123", defaultExpiry: () => new Date("2099-01-01") }));

// db: insert(intakeForms) → returning id; select(intakeEmailSettings) → the
// sender's personal settings row (keyed on firmId+userId, unrelated to the
// client's advisor).
const settingsRow = { fromName: "Acme Personal Desk", subject: "Let's begin", introBody: "Hi {{clientName}}" };
vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [{ id: "form_1" }] }) }),
    select: () => ({ from: () => ({ where: async () => [settingsRow] }) }),
  },
}));

// getAdvisorProfile is mocked directly — it uses db.query.advisorProfiles.findFirst,
// a different code path from the @/db mock above, whose select().from().where()
// shape only serves the intake_email_settings query and is table-blind.
vi.mock("@/lib/branding/advisor-profile", () => ({ getAdvisorProfile: vi.fn(async () => null) }));

// Only reached when a blank invite carries a clientId (case 5 below) — blank
// invites without one never call it.
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));

import { POST } from "@/app/api/data-collection/route";

function postReq(overrides: Record<string, unknown> = {}) {
  return new Request("http://t/api/data-collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "blank",
      recipientEmail: "sam@client.com",
      recipientName: "Sam Client",
      ...overrides,
    }),
  });
}

function advisorRow(overrides: Partial<AdvisorProfileRow>): AdvisorProfileRow {
  return {
    id: "adv-row-1",
    firmId: "firm_1",
    advisorUserId: "user_1",
    brandingEnabled: false,
    brandName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    contactEmail: null,
    contactPhone: null,
    website: null,
    address: null,
    emailFromName: null,
    emailReplyTo: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(sendIntakeFormEmail).mockClear();
  vi.mocked(getAdvisorProfile).mockReset();
  vi.mocked(getAdvisorProfile).mockResolvedValue(null);
  vi.mocked(requireClientEditAccess).mockReset();
});

it("blank send threads per-advisor settings + advisor email into the email", async () => {
  const res = await POST(postReq());
  expect(res.status).toBe(200);
  expect(vi.mocked(sendIntakeFormEmail)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sendIntakeFormEmail).mock.calls[0][0]).toMatchObject({
    to: "sam@client.com",
    link: expect.stringContaining("/intake/tok123"),
    fromName: "Acme Personal Desk",
    subject: "Let's begin",
    introBody: "Hi {{clientName}}",
    advisorName: "Jane Advisor",
    advisorEmail: "jane@acme.com",
    firmName: "Acme Wealth",
    clientName: "Sam Client",
  });
});

it("case 1: brandingEnabled + emailFromName/emailReplyTo set -> advisor brand wins", async () => {
  vi.mocked(getAdvisorProfile).mockResolvedValue(
    advisorRow({ brandingEnabled: true, emailFromName: "Jane Smith CFP", emailReplyTo: "jane@smithwealth.com" }),
  );

  const res = await POST(postReq());

  expect(res.status).toBe(200);
  // No clientId on the request -> keyed on the sending userId.
  expect(vi.mocked(getAdvisorProfile)).toHaveBeenCalledWith("firm_1", "user_1");
  const payload = vi.mocked(sendIntakeFormEmail).mock.calls[0][0];
  expect(payload.fromName).toBe("Jane Smith CFP");
  expect(payload.replyTo).toBe("jane@smithwealth.com");
});

it('case 2: brandingEnabled + emailFromName blank ("") falls through to intake_email_settings.fromName', async () => {
  vi.mocked(getAdvisorProfile).mockResolvedValue(
    advisorRow({ brandingEnabled: true, emailFromName: "", emailReplyTo: null }),
  );

  const res = await POST(postReq());

  expect(res.status).toBe(200);
  const payload = vi.mocked(sendIntakeFormEmail).mock.calls[0][0];
  expect(payload.fromName).toBe("Acme Personal Desk");
  expect(payload.replyTo).toBeUndefined();
});

it("case 2b: brandingEnabled + emailFromName null falls through to intake_email_settings.fromName", async () => {
  vi.mocked(getAdvisorProfile).mockResolvedValue(
    advisorRow({ brandingEnabled: true, emailFromName: null, emailReplyTo: null }),
  );

  const res = await POST(postReq());

  expect(res.status).toBe(200);
  const payload = vi.mocked(sendIntakeFormEmail).mock.calls[0][0];
  expect(payload.fromName).toBe("Acme Personal Desk");
  expect(payload.replyTo).toBeUndefined();
});

it("case 3: brandingEnabled false gates the brand fields off even though emailFromName is set", async () => {
  vi.mocked(getAdvisorProfile).mockResolvedValue(
    advisorRow({ brandingEnabled: false, emailFromName: "Jane Smith CFP", emailReplyTo: "jane@smithwealth.com" }),
  );

  const res = await POST(postReq());

  expect(res.status).toBe(200);
  const payload = vi.mocked(sendIntakeFormEmail).mock.calls[0][0];
  expect(payload.fromName).toBe("Acme Personal Desk");
  expect(payload.replyTo).toBeUndefined();
});

it("case 4: no advisor profile row -> existing fromName/subject/introBody behavior unchanged, no replyTo", async () => {
  vi.mocked(getAdvisorProfile).mockResolvedValue(null);

  const res = await POST(postReq());

  expect(res.status).toBe(200);
  const payload = vi.mocked(sendIntakeFormEmail).mock.calls[0][0];
  expect(payload.fromName).toBe("Acme Personal Desk");
  expect(payload.replyTo).toBeUndefined();
  expect(payload.subject).toBe("Let's begin");
  expect(payload.introBody).toBe("Hi {{clientName}}");
});

it("case 5: blank invite WITH a clientId resolves brand by the CLIENT's advisor, not the sender", async () => {
  // Sender (user_1) has no brand of their own; the client's advisor (adv_2) does.
  vi.mocked(getAdvisorProfile).mockImplementation(async (_firmId, advisorUserId) => {
    if (advisorUserId === "adv_2") {
      return advisorRow({
        firmId: "firm_1",
        advisorUserId: "adv_2",
        brandingEnabled: true,
        emailFromName: "Jane Smith CFP",
        emailReplyTo: "jane@smithwealth.com",
      });
    }
    return null;
  });
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    firmId: "firm_1",
    access: "own",
    client: { advisorId: "adv_2" },
  } as never);

  const res = await POST(postReq({ clientId: "client_1" }));

  expect(res.status).toBe(200);
  expect(vi.mocked(getAdvisorProfile)).toHaveBeenCalledWith("firm_1", "adv_2");
  expect(vi.mocked(getAdvisorProfile)).not.toHaveBeenCalledWith("firm_1", "user_1");
  const payload = vi.mocked(sendIntakeFormEmail).mock.calls[0][0];
  expect(payload.fromName).toBe("Jane Smith CFP");
  expect(payload.replyTo).toBe("jane@smithwealth.com");
});
