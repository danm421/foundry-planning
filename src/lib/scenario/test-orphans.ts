// Leaked integration-test scenarios, hidden from every list an advisor sees.
//
// Lives in lib, not beside the chip row that first needed it, so server code
// (the report suggestions' scenario read) can share the one list — a function
// exported from a "use client" module is a client reference on the server.

// Name prefixes used by integration tests that insert into the `scenarios`
// table (see `.insert(scenarios)` in src/**/__tests__/*.test.ts). Each test
// names rows `<prefix><uuid-slice>` and deletes them in afterEach; leaked rows
// from crashed runs are filtered out wherever scenarios are listed.
const TEST_ORPHAN_PREFIXES = [
  "writer-test-",
  "nr-loader-test-",
  "nr-fast-path-host-",
  "nr-filter-",
  "preview-fidelity-",
  "change-cid-test-",
  "change-cid-other-",
  "delta-preview-cache-",
  "delta-preview-test-",
  "load-changes-test-",
  "route-list-test-",
  "route-test-",
  "tg-gid-test-",
  "tg-test-",
  "tg-other-",
  "clone-src-",
  "flow-inherit-scn-",
  "flow-mixed-scn-",
] as const;

/** Drops leaked integration-test scenarios (see TEST_ORPHAN_PREFIXES). */
export function withoutTestOrphans<T extends { name: string }>(scenarios: T[]): T[] {
  return scenarios.filter((s) => !TEST_ORPHAN_PREFIXES.some((p) => s.name.startsWith(p)));
}
