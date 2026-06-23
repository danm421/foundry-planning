// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RuleCreateDialog } from "@/components/portal/rule-create-dialog";

const cats = [
  { id: "g1", name: "Food", kind: "group" as const, parentId: null },
  { id: "l1", name: "Restaurants", kind: "category" as const, parentId: "g1" },
];

beforeEach(() => vi.restoreAllMocks());

describe("RuleCreateDialog", () => {
  it("shows a preview count and submits a rule", async () => {
    const calls: string[] = [];
    const postBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (init?.method === "POST") postBodies.push(JSON.parse(init.body as string));
      if (url.includes("/preview")) return { ok: true, json: async () => ({ count: 5 }) } as Response;
      return { ok: true, json: async () => ({ id: "r1", applied: 5 }) } as Response;
    }) as unknown as typeof fetch;

    const onCreated = vi.fn();
    render(<RuleCreateDialog seed={{ merchantName: "Chipotle", name: "CHIPOTLE", categoryId: "l1" }} categories={cats} onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByText(/Will apply to 5 transactions/)).toBeTruthy());
    fireEvent.click(screen.getByText("Create rule"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(5));
    expect(calls.some((u) => u.endsWith("/api/portal/rules"))).toBe(true);
    expect(postBodies[0]).toEqual({ matchType: "contains", pattern: "Chipotle", categoryId: "l1" });
  });
});
