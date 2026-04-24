import type { AuditAction } from "@/lib/audit";

type Row = { action: AuditAction | string; metadata?: unknown };

const LABELS: Record<string, string> = {
  "open_item.create": "Added open item",
  "open_item.update": "Updated open item",
  "open_item.complete": "Completed open item",
  "open_item.delete": "Deleted open item",
  "account.create": "Added account",
  "account.update": "Updated account",
  "account.delete": "Deleted account",
  "liability.create": "Added liability",
  "liability.update": "Updated liability",
  "liability.delete": "Deleted liability",
  "income.create": "Added income",
  "income.update": "Updated income",
  "income.delete": "Deleted income",
  "expense.create": "Added expense",
  "expense.update": "Updated expense",
  "expense.delete": "Deleted expense",
  "savings_rule.create": "Added savings rule",
  "savings_rule.update": "Updated savings rule",
  "savings_rule.delete": "Deleted savings rule",
  "client.update": "Updated client details",
  "client.extract": "Imported document",
};

export function formatAuditRow(row: Row): string {
  const label = LABELS[row.action as string];
  if (label) return label;
  return String(row.action).replace(/[._]/g, " ");
}
