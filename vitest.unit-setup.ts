import { Client } from "@neondatabase/serverless";

// Setup for the parallel "unit" project only (see vitest.config.ts). A file
// that opens a database connection here would race the serial "db" project on
// the shared dev Neon branch, so every connection fails with directions.
process.env.DATABASE_URL = "postgresql://unit-project:no-database@127.0.0.1:1/none";

const misplaced = () =>
  new Error(
    'This test opened a database connection, but it runs in the parallel "unit" ' +
      'project. Import `db` from "@/db" in the test file, or add the file to ' +
      "DB_TESTS_WITHOUT_A_DB_IMPORT in vitest.config.ts.",
  );

Client.prototype.connect = function (callback?: (err: Error) => void) {
  if (callback) return void process.nextTick(callback, misplaced());
  return Promise.reject(misplaced());
} as typeof Client.prototype.connect;
