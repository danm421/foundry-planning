import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Every intake form sent to one client resolves to that client's household,
// so a public link's list, delete and caps must key on the form itself. These
// tests read the conditions each query is built with; the real two-form case
// runs against the database in documents-household.test.ts.

const dialect = new PgDialect();
const wheres: { table: string; sql: string; params: unknown[] }[] = [];
const inserted: Record<string, unknown>[] = [];
let rowsByTable: Record<string, unknown[]> = {};

function selectChain() {
  let table = "";
  const chain = {
    from(t: Table) {
      table = getTableName(t);
      return chain;
    },
    where(cond: SQL) {
      const q = dialect.sqlToQuery(cond);
      wheres.push({ table, sql: q.sql, params: q.params });
      return chain;
    },
    for: () => chain,
    orderBy: () => chain,
    then(resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(rowsByTable[table] ?? []).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@/db", () => {
  const db = {
    select: () => selectChain(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          returning: async () => [
            { ...v, id: "doc-new", createdAt: new Date("2026-10-01T00:00:00Z") },
          ],
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string) => ({ pathname: key })),
  del: vi.fn(async () => undefined),
}));
vi.mock("@/lib/crm/folders", () => ({ ensureIntakeFolder: vi.fn(async () => "folder-1") }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

import {
  deleteIntakeDocument,
  listIntakeDocuments,
  uploadIntakeDocument,
} from "../documents";

const FORM = "form-2";

beforeEach(() => {
  wheres.length = 0;
  inserted.length = 0;
  // An existing client's form: documents route through the client's household.
  rowsByTable = {
    intake_forms: [{ firmId: "firm-1", clientId: "client-1", crmHouseholdId: null }],
    clients: [{ crmHouseholdId: "hh-1" }],
    crm_household_documents: [],
  };
});

function documentQueries() {
  return wheres.filter((w) => w.table === "crm_household_documents");
}

function bindsThisForm(w: { sql: string; params: unknown[] }) {
  return w.sql.includes('"intake_form_id"') && w.params.includes(FORM);
}

describe("intake documents are scoped to the form they were uploaded through", () => {
  it("lists only this form's uploads", async () => {
    await listIntakeDocuments(FORM);
    const [query] = documentQueries();
    expect(query).toBeDefined();
    expect(bindsThisForm(query)).toBe(true);
  });

  it("finds a document to delete only among this form's uploads", async () => {
    await deleteIntakeDocument(FORM, "doc-1");
    const [lookup] = documentQueries();
    expect(lookup).toBeDefined();
    expect(bindsThisForm(lookup)).toBe(true);
  });

  it("records the form on each upload and counts the limits per form", async () => {
    rowsByTable.crm_household_documents = [{ count: 0, bytes: 0 }];
    const file = new File([Buffer.from("%PDF-1.4\n%stub\n")], "w2.pdf", {
      type: "application/pdf",
    });
    await uploadIntakeDocument(FORM, file, "tax_return");

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ intakeFormId: FORM, sourceKind: "intake_upload" });
    const [capQuery] = documentQueries();
    expect(bindsThisForm(capQuery)).toBe(true);
  });

  it("lets the advisor's review list every intake upload in the household", async () => {
    await listIntakeDocuments(FORM, { wholeHousehold: true });
    const [query] = documentQueries();
    expect(query.sql).not.toContain('"intake_form_id"');
    expect(query.params).toContain("hh-1");
  });
});
