import type {
  AssetAccount,
  AssetCategory,
} from "@/components/account-groups/types";

export type TreeNode = {
  key: string;
  label: string;
  count: number;
  value: number;
  accounts?: AssetAccount[]; // present on leaf nodes
  children?: TreeNode[]; // present on branch nodes
};

const LEAF_LABELS: Record<AssetCategory, string> = {
  taxable: "Taxable",
  retirement: "Retirement",
  cash: "Cash",
  annuity: "Annuity",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
  notes_receivable: "Notes Receivable",
  education_savings: "529 / Education",
};

const LIQUID_CATEGORIES: AssetCategory[] = ["taxable", "retirement", "cash"];
const ILLIQUID_CATEGORIES: AssetCategory[] = [
  "annuity",
  "real_estate",
  "business",
  "life_insurance",
  "notes_receivable",
  "education_savings",
];

function leafNode(category: AssetCategory, accounts: AssetAccount[]): TreeNode {
  const members = accounts.filter((a) => a.category === category);
  return {
    key: category,
    label: LEAF_LABELS[category],
    count: members.length,
    value: members.reduce((s, a) => s + a.value, 0),
    accounts: members,
  };
}

function branchNode(key: string, label: string, children: TreeNode[]): TreeNode {
  return {
    key,
    label,
    count: children.reduce((s, c) => s + c.count, 0),
    value: children.reduce((s, c) => s + c.value, 0),
    children,
  };
}

/** Build the fixed default account-group hierarchy from a client's accounts.
 *  All categories are always represented (empty leaves stay at 0 / $0), so a
 *  parent's children always sum exactly to its total. Returns a single root. */
export function buildAssetTree(accounts: AssetAccount[]): TreeNode[] {
  const allLiquid = branchNode(
    "all-liquid",
    "All Liquid Assets",
    LIQUID_CATEGORIES.map((c) => leafNode(c, accounts)),
  );
  const illiquidLeaves = ILLIQUID_CATEGORIES.map((c) => leafNode(c, accounts));
  const allAssets = branchNode("all-assets", "All Assets", [
    allLiquid,
    ...illiquidLeaves,
  ]);
  return [allAssets];
}
