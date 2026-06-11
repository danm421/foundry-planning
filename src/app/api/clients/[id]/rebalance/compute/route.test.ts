import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/investments/rebalance/load-inputs", () => ({ loadRebalanceInputs: vi.fn() }));

import { POST } from "./route";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
// load-inputs is mocked above so the route never touches the DB; not referenced directly.

const ctx = { params: Promise.resolve({ id: "client-1" }) };
const req = (body: unknown) => new Request("http://t/compute", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(requireOrgId).mockResolvedValue("firm-1");
  vi.mocked(verifyClientAccess).mockResolvedValue(true);
});

describe("POST rebalance/compute", () => {
  it("404s when the client is not in the firm", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue(false);
    const res = await POST(req({ accountIds: ["a"], target: { portfolioId: "p" } }), ctx);
    expect(res.status).toBe(404);
  });

  it("400s on an invalid body", async () => {
    const res = await POST(req({ accountIds: [] }), ctx);
    expect(res.status).toBe(400);
  });
});
