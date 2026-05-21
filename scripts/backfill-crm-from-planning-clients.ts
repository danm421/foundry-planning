// One-shot backfill — RETIRED. This script populated crm_households +
// crm_household_contacts from the legacy clients identity columns during
// Phase 6 of the CRM port. As of Phase 9 (migration 0117), those legacy
// columns no longer exist on the clients table, so this script cannot run
// against the current schema. Kept as a tombstone for git-history readers.
//
// If you need to re-seed CRM contacts for an environment that diverged
// from production, restore the columns from a snapshot first, then check
// out the commit before 678b9999 to run the original script.

async function main(): Promise<void> {
  console.error(
    "[backfill] This script is retired. The legacy clients.first_name / last_name / date_of_birth / spouse_* / email / address columns were dropped in migration 0117. See the comment at the top of this file.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
