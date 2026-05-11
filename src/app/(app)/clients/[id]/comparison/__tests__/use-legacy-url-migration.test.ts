// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

import { useLegacyUrlMigration } from "../use-legacy-url-migration";

const PATH = "/clients/c/comparison";

describe("useLegacyUrlMigration", () => {
  let replaceSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replaceSpy = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace: replaceSpy } as never);
    vi.mocked(usePathname).mockReturnValue(PATH);
  });

  it("rewrites ?left=&right= to ?plans= on mount", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("left=base&right=sid_x") as never);
    renderHook(() => useLegacyUrlMigration());
    expect(replaceSpy).toHaveBeenCalledWith(`${PATH}?plans=base%2Csid_x`);
  });

  it("does nothing when ?plans is already present", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("plans=base,sid_x") as never);
    renderHook(() => useLegacyUrlMigration());
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no relevant params are present", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("") as never);
    renderHook(() => useLegacyUrlMigration());
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
