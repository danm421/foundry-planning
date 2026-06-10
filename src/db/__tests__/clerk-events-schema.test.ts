import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { clerkEvents } from "@/db/schema";

describe("clerkEvents table", () => {
  it("mirrors billing_events shape: svix_id unique + result + timing columns", () => {
    const cfg = getTableConfig(clerkEvents);
    expect(cfg.name).toBe("clerk_events");
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));

    expect(byName.id?.primary).toBe(true);
    expect(byName.svix_id?.notNull).toBe(true);
    expect(byName.svix_id?.isUnique).toBe(true);
    expect(byName.event_type?.notNull).toBe(true);
    expect(byName.result).toBeDefined(); // nullable
    expect(byName.processed_at).toBeDefined();
    expect(byName.processing_duration_ms).toBeDefined();
    expect(byName.error_message).toBeDefined();
    expect(byName.created_at).toBeDefined();
  });
});
