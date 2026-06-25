import { it, expect, beforeEach, vi } from "vitest";
import { sendIntakeFormEmail } from "@/lib/intake/email";

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

// db: insert(intakeForms) → returning id; select(intakeEmailSettings) → custom row
const settingsRow = { fromName: "Acme Wealth", subject: "Let's begin", introBody: "Hi {{clientName}}" };
vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [{ id: "form_1" }] }) }),
    select: () => ({ from: () => ({ where: async () => [settingsRow] }) }),
  },
}));

import { POST } from "@/app/api/data-collection/route";

beforeEach(() => {
  vi.mocked(sendIntakeFormEmail).mockClear();
});

it("blank send threads per-advisor settings + advisor email into the email", async () => {
  const req = new Request("http://t/api/data-collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "blank", recipientEmail: "sam@client.com", recipientName: "Sam Client" }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  expect(vi.mocked(sendIntakeFormEmail)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sendIntakeFormEmail).mock.calls[0][0]).toMatchObject({
    to: "sam@client.com",
    link: "https://app.foundryplanning.com/intake/tok123",
    fromName: "Acme Wealth",
    subject: "Let's begin",
    introBody: "Hi {{clientName}}",
    advisorName: "Jane Advisor",
    advisorEmail: "jane@acme.com",
    firmName: "Acme Wealth",
    clientName: "Sam Client",
  });
});
