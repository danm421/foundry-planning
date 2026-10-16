// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { AccountFormPanel, emptyAccountForm, SUBTYPES_BY_CATEGORY } from "../account-form-panel";

describe("AccountFormPanel — annuity sub-types", () => {
  it("offers an annuity the three tax treatments, not 'other'", () => {
    // Left on ["other"], the portal would keep writing the one sub-type the
    // advisor's Account Type dropdown no longer offers — which renders that
    // select with no matching option.
    expect(SUBTYPES_BY_CATEGORY.annuity).toEqual([
      "non_qualified",
      "qualified",
      "tax_free",
    ]);
  });

  it("starts a new annuity on non-qualified", () => {
    expect(emptyAccountForm("annuity").subType).toBe("non_qualified");
  });
});

describe("AccountFormPanel", () => {
  // POST /api/portal/accounts rejects any category outside
  // PORTAL_VISIBLE_CATEGORIES with a 400, so offering one in the picker loses
  // the client's form. Asserting the WHOLE option set catches both directions:
  // a category wrongly restored (e.g. annuity) and one wrongly dropped.
  it("offers exactly the four categories the POST route accepts", () => {
    const { getByLabelText } = render(
      <AccountFormPanel
        form={emptyAccountForm()}
        setForm={() => {}}
        familyMembers={[]}
        trustEntities={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
        disabled={false}
        plaidLocked={false}
      />,
    );

    const category = getByLabelText("Category") as HTMLSelectElement;
    const values = Array.from(category.options).map((o) => o.value);

    expect(values).toEqual(["cash", "taxable", "retirement", "real_estate"]);
  });
});

describe("AccountFormPanel — sub-type picker", () => {
  function subTypeOptions(form: ReturnType<typeof emptyAccountForm>) {
    const { getByLabelText } = render(
      <AccountFormPanel
        form={form}
        setForm={() => {}}
        familyMembers={[]}
        trustEntities={[]}
        onCancel={() => {}}
        onSubmit={() => {}}
        disabled={false}
        plaidLocked={false}
      />,
    );
    const select = getByLabelText("Sub-type") as HTMLSelectElement;
    return { select, labels: Array.from(select.options).map((o) => o.textContent) };
  }

  // Every retirement sub-type the engine models, in display case — not raw
  // enum tokens like "traditional ira". HSA lives here (not under Cash): the
  // engine's HSA tax and withdrawal rules key on category "retirement". 529 is
  // gone — it is its own category now (migration 0203).
  it("offers every retirement plan type, properly labelled", () => {
    expect(subTypeOptions(emptyAccountForm("retirement")).labels).toEqual([
      "Traditional IRA",
      "Roth IRA",
      "401(k)",
      "403(b)",
      "401(a)",
      "SEP IRA",
      "SIMPLE IRA",
      "HSA",
      "Other",
    ]);
  });

  // An account whose sub-type isn't in its category's list would otherwise
  // render the select on the first option, and Save would silently rewrite it.
  it("keeps an existing sub-type the list doesn't offer", () => {
    const { select, labels } = subTypeOptions({ ...emptyAccountForm("taxable"), subType: "trust" });
    expect(labels).toContain("Trust");
    expect(select.value).toBe("trust");
  });
});
