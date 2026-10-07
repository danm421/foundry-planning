// Every /api/data-collection/[id] action needs the caller to reach the form's
// client (or, before a client exists, the book of the advisor who sent it), not
// just to share the firm. A form the caller can't reach answers 404, the same
// as a missing one, and nothing is applied, changed, mailed or rendered.
import { describe, it, expect, vi, beforeEach } from "vitest";

const forms = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const spies = vi.hoisted(() => ({
  applyIntake: vi.fn(),
  dbUpdate: vi.fn(),
  sendMail: vi.fn(),
  renderPdf: vi.fn(),
  requireClientEditAccess: vi.fn(),
  callerMaySeeAdvisor: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "advisor-a", orgId: "firm-1", orgRole: "org:member" }),
}));
vi.mock("@/lib/db-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/db-helpers")>()),
  requireOrgAndUser: async () => ({ orgId: "firm-1", userId: "advisor-a" }),
}));
vi.mock("@/lib/authz", async (orig) => ({
  ...(await orig<typeof import("@/lib/authz")>()),
  requireActiveSubscriptionForFirm: async () => undefined,
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: spies.requireClientEditAccess,
  callerMaySeeAdvisor: spies.callerMaySeeAdvisor,
}));
vi.mock("@/lib/intake/queries", () => ({
  loadFormForFirm: async () => forms.current,
  readFormForFirm: async () => forms.current,
}));
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => {
        spies.dbUpdate(v);
        const where = () => Object.assign(Promise.resolve(), { returning: async () => [{ id: "form-1" }] });
        return { where };
      },
    }),
  },
}));
vi.mock("@/lib/intake/apply", () => ({ applyIntake: spies.applyIntake }));
vi.mock("@/lib/intake/link-client", () => ({ linkIntakeFormToClient: vi.fn() }));
vi.mock("@/lib/intake/send-form-email", () => ({ sendIntakeLinkEmail: spies.sendMail }));
vi.mock("@/lib/intake/form-link", () => ({
  resolveFormLink: async () => ({ link: "https://x/f", brandAdvisorUserId: null }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkIntakeRemindRateLimit: async () => ({ allowed: true }),
  checkExportPdfRateLimit: async () => ({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/intake/documents", () => ({ listIntakeDocuments: async () => [] }));
vi.mock("@/lib/branding/branding", () => ({ resolveBranding: async () => ({ firmName: "F" }) }));
vi.mock("@/lib/presentations/default-logo", () => ({ foundryDefaultLogoDataUrl: async () => null }));
vi.mock("@/lib/intake/schema", () => ({
  intakeSubmitSchemaFor: () => ({ safeParse: (p: unknown) => ({ success: true, data: p }) }),
}));
vi.mock("@/lib/intake/answers-document", () => ({ buildIntakeAnswersDocument: () => ({ householdName: "H" }) }));
vi.mock("@/components/intake-answers-pdf/intake-answers-pdf-document", () => ({ IntakeAnswersPdfDocument: () => null }));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: async () => {
    spies.renderPdf();
    return Buffer.from("pdf");
  },
}));

import { ForbiddenError } from "@/lib/authz";
import { POST as apply } from "../apply/route";
import { POST as discard } from "../discard/route";
import { POST as revoke } from "../revoke/route";
import { POST as remind } from "../remind/route";
import { POST as reopen } from "../reopen/route";
import { POST as exportPdf } from "../export-pdf/route";

const future = new Date(Date.now() + 86_400_000);
const formBase = {
  id: "form-1",
  firmId: "firm-1",
  createdByUserId: "advisor-b",
  recipientEmail: "client@example.com",
  recipientName: "Client",
  sections: ["accounts"],
  payload: {},
  sentAt: new Date(),
  expiresAt: future,
};

// Each route, with a form in the state that lets it act.
const routes = [
  { name: "apply", post: apply, form: { status: "submitted", submittedAt: new Date() }, effect: spies.applyIntake },
  { name: "discard", post: discard, form: { status: "submitted", submittedAt: new Date() }, effect: spies.dbUpdate },
  { name: "revoke", post: revoke, form: { status: "draft", submittedAt: null }, effect: spies.dbUpdate },
  { name: "remind", post: remind, form: { status: "draft", submittedAt: null }, effect: spies.sendMail },
  { name: "reopen", post: reopen, form: { status: "submitted", submittedAt: new Date() }, effect: spies.dbUpdate },
  { name: "export-pdf", post: exportPdf, form: { status: "submitted", submittedAt: new Date() }, effect: spies.renderPdf },
];

const call = (post: (typeof routes)[number]["post"]) =>
  post(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "form-1" }) });

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
  spies.applyIntake.mockResolvedValue({ clientId: "client-b" });
  spies.sendMail.mockResolvedValue({ delivered: true });
  // advisor-a is not on client-b and cannot see advisor-b's book.
  spies.requireClientEditAccess.mockRejectedValue(new ForbiddenError("Client not found or access denied"));
  spies.callerMaySeeAdvisor.mockResolvedValue(false);
});

describe.each(routes)("POST /api/data-collection/[id]/$name", ({ post, form, effect }) => {
  it("answers 404 for a form bound to a client the caller can't edit", async () => {
    forms.current = { ...formBase, ...form, clientId: "client-b" };
    const res = await call(post);
    expect(res.status).toBe(404);
    expect(spies.requireClientEditAccess).toHaveBeenCalledWith("client-b");
    expect(effect).not.toHaveBeenCalled();
  });

  it("answers 404 for a prospect form from an advisor outside the caller's book", async () => {
    forms.current = { ...formBase, ...form, clientId: null };
    const res = await call(post);
    expect(res.status).toBe(404);
    expect(spies.callerMaySeeAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "advisor-a" }),
      "advisor-b",
      "firm-1",
    );
    expect(effect).not.toHaveBeenCalled();
  });

  it("acts on a form whose client the caller can edit", async () => {
    forms.current = { ...formBase, ...form, clientId: "client-b" };
    spies.requireClientEditAccess.mockResolvedValue({ client: {}, firmId: "firm-1", access: "own" });
    const res = await call(post);
    expect(res.status).toBe(200);
    expect(effect).toHaveBeenCalled();
  });
});
