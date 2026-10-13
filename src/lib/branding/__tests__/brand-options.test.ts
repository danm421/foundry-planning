// src/lib/branding/__tests__/brand-options.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  listAdvisorProfiles: vi.fn(),
  listFirmMembers: vi.fn(),
  getBranding: vi.fn(),
  resolveFirmName: vi.fn(),
  resolveVisibleAdvisorIds: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("@/lib/branding/advisor-profile", () => ({ listAdvisorProfiles: m.listAdvisorProfiles }));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: m.listFirmMembers }));
vi.mock("@/lib/branding/db", () => ({ getBranding: m.getBranding }));
vi.mock("@/lib/branding/branding", () => ({ resolveFirmName: m.resolveFirmName }));
vi.mock("@/lib/visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...actual, resolveVisibleAdvisorIds: m.resolveVisibleAdvisorIds };
});

import { ForbiddenError } from "@/lib/authz";
import {
  assertBrandChoiceAllowed,
  listBrandOptions,
  listFirmBrands,
  loadBrandPicker,
} from "../brand-options";

const FIRM_ID = "org_acme";
const admin = { userId: "user_admin", orgId: FIRM_ID, orgRole: "org:admin" };
const staff = { userId: "user_staff", orgId: FIRM_ID, orgRole: "org:planner" };
const advisor = { userId: "user_bob", orgId: FIRM_ID, orgRole: "org:member" };
const outsider = { userId: "user_x", orgId: "org_other", orgRole: "org:admin" };

const profile = (advisorUserId: string, over: { brandingEnabled?: boolean; brandName?: string | null } = {}) => ({
  advisorUserId,
  brandingEnabled: true,
  brandName: null,
  ...over,
});
const member = (userId: string, displayName: string) => ({
  userId, displayName, email: `${userId}@x.test`, imageUrl: null, role: "Member", roleKey: "org:member",
});

const FIRM = { value: "firm", label: "Acme Wealth (firm)" };
const BOB = { value: "user_bob", label: "Bob Ray" };
const JANE = { value: "user_jane", label: "Smith Wealth" };

beforeEach(() => {
  vi.clearAllMocks();
  m.listAdvisorProfiles.mockResolvedValue([
    profile("user_jane", { brandName: "Smith Wealth" }),
    profile("user_bob"),
    profile("user_off", { brandingEnabled: false, brandName: "Off Brand" }),
    profile("user_gone", { brandName: "Gone Wealth" }),
  ]);
  m.listFirmMembers.mockResolvedValue([
    member("user_jane", "Jane Smith"),
    member("user_bob", "Bob Ray"),
    member("user_off", "Olive Off"),
    member("user_staff", "Sam Staff"),
  ]);
  m.getBranding.mockResolvedValue({ displayName: "Acme Cached" });
  m.resolveFirmName.mockResolvedValue("Acme Wealth");
  m.resolveVisibleAdvisorIds.mockResolvedValue(new Set(["user_jane"]));
});

describe("listFirmBrands", () => {
  it("lists the firm first, then every member whose branding is on, by label", async () => {
    expect(await listFirmBrands(FIRM_ID)).toEqual([FIRM, BOB, JANE]);
    expect(m.resolveFirmName).toHaveBeenCalledWith(FIRM_ID, "Acme Cached");
  });
});

describe("listBrandOptions", () => {
  it("gives an admin every brand", async () => {
    expect(await listBrandOptions(FIRM_ID, admin)).toEqual([FIRM, BOB, JANE]);
  });

  it("gives staff the firm plus the advisors they're assigned to", async () => {
    expect(await listBrandOptions(FIRM_ID, staff)).toEqual([FIRM, JANE]);
    expect(m.resolveVisibleAdvisorIds).toHaveBeenCalledWith("user_staff", "org:planner", FIRM_ID);
  });

  it("gives an advisor only the firm brand", async () => {
    expect(await listBrandOptions(FIRM_ID, advisor)).toEqual([FIRM]);
  });

  it("gives someone from another firm nothing, without reading that firm's brands", async () => {
    expect(await listBrandOptions(FIRM_ID, outsider)).toEqual([]);
    expect(m.listAdvisorProfiles).not.toHaveBeenCalled();
  });
});

describe("assertBrandChoiceAllowed", () => {
  it("lets the default through without any lookup", async () => {
    await expect(assertBrandChoiceAllowed(FIRM_ID, "user_bob", "user_bob")).resolves.toBeUndefined();
    expect(m.auth).not.toHaveBeenCalled();
    expect(m.listAdvisorProfiles).not.toHaveBeenCalled();
  });

  it("lets staff pick an assigned advisor's brand and refuses another's", async () => {
    m.auth.mockResolvedValue(staff);
    await expect(assertBrandChoiceAllowed(FIRM_ID, "user_jane", "user_bob")).resolves.toBeUndefined();
    await expect(assertBrandChoiceAllowed(FIRM_ID, "user_bob", "user_jane")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a departed advisor's brand even to an admin", async () => {
    m.auth.mockResolvedValue(admin);
    await expect(assertBrandChoiceAllowed(FIRM_ID, "user_gone", "user_bob")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("treats 'firm' as the default when the default advisor's brand is off", async () => {
    m.auth.mockResolvedValue(outsider);
    await expect(assertBrandChoiceAllowed(FIRM_ID, "firm", "user_off")).resolves.toBeUndefined();
    await expect(assertBrandChoiceAllowed(FIRM_ID, "firm", "user_jane")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses another firm's advisor id outright", async () => {
    m.auth.mockResolvedValue(admin);
    await expect(assertBrandChoiceAllowed(FIRM_ID, "user_other_firm", "user_bob")).rejects.toThrow(
      "That brand isn't available to you for this household.",
    );
  });
});

describe("loadBrandPicker", () => {
  it("hands an admin the choices and the full label list", async () => {
    m.auth.mockResolvedValue(admin);
    expect(await loadBrandPicker(FIRM_ID)).toEqual({ options: [FIRM, BOB, JANE], allBrands: [FIRM, BOB, JANE] });
  });

  it("hands an advisor nothing, so no brand names reach their browser", async () => {
    m.auth.mockResolvedValue(advisor);
    expect(await loadBrandPicker(FIRM_ID)).toEqual({ options: [], allBrands: [] });
  });

  it("hands a signed-out request nothing", async () => {
    m.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    expect(await loadBrandPicker(FIRM_ID)).toEqual({ options: [], allBrands: [] });
  });
});
