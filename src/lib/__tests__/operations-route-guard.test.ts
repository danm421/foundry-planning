import { describe, it, expect } from "vitest";
import {
  isOperationsAllowedPath,
  operationsBlocked,
} from "../operations-route-guard";

describe("operations route guard", () => {
  it("allows CRM, tasks, their APIs, and the org picker", () => {
    for (const p of [
      "/crm",
      "/crm/households",
      "/tasks",
      "/api/crm/tasks",
      "/api/crm/households",
      "/select-organization",
    ]) {
      expect(isOperationsAllowedPath(p)).toBe(true);
    }
  });

  it("blocks planning + CMA + their APIs for operations", () => {
    for (const p of ["/clients", "/clients/abc", "/cma", "/api/clients", "/api/cma"]) {
      expect(operationsBlocked("org:operations", p)).toBe(true);
    }
  });

  it("never blocks non-operations roles", () => {
    for (const role of ["org:owner", "org:admin", "org:member", "org:planner"]) {
      expect(operationsBlocked(role, "/clients")).toBe(false);
    }
  });

  it("does not treat /crmfoo as an allowed CRM path", () => {
    expect(isOperationsAllowedPath("/crmfoo")).toBe(false);
  });
});
