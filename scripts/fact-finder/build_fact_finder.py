"""Builds the Client Fact Finder PDF — a fillable fact finder whose fields
mirror Foundry Planning's data-entry forms.

src/lib/fact-finder/schema.ts is the other half of this file. A form field is
named <key>_r<row>_c<col> (transposed tables: r = field, c = policy), and
Reader 1 maps it back through the schema's pdfIndex. NEVER renumber a column:
copies of this PDF are already with clients. Add new columns at the END of a
table. src/lib/fact-finder/__tests__/schema-pdf-alignment.test.ts checks the
committed blank PDF against the schema.

Run (from the repo root):
  python3 scripts/fact-finder/build_fact_finder.py
      --out src/lib/fact-finder/__fixtures__/fact-finder-blank.pdf
  python3 scripts/fact-finder/build_fact_finder.py --out filled.pdf --fill values.json

--fill takes a JSON object of field name -> value (text, a choice label, or
true for a checked box). A choice value that isn't in the field's list is
appended to that field's list, the way an older printed copy carries it.
"""
import argparse
import json

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

OUT = "Client-Fact-Finder.pdf"
PAGE_W, PAGE_H = landscape(letter)
M = 36  # page margin
W = PAGE_W - 2 * M

NAVY = HexColor("#1F2A55")
INK = HexColor("#1D2433")
MUTED = HexColor("#5B6475")
GRID = HexColor("#A3ABBB")
HEAD_BG = HexColor("#E9EDF4")
LABEL_BG = HexColor("#F3F5F9")
FIELD_BG = HexColor("#F7F9FD")

ROW_H = 17
FONT = "Helvetica"
BOLD = "Helvetica-Bold"

# ---- option lists (labels match the app's dropdowns) ------------------------
YES_NO = ["Yes", "No"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT "
          "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split()
FILING = ["Single", "Married filing jointly", "Married filing separately", "Head of household"]
RELATIONSHIP = ["Child", "Stepchild", "Grandchild", "Great-grandchild", "Parent", "Grandparent",
                "Sibling", "Sibling-in-law", "Son/Daughter-in-law", "Niece/Nephew", "Aunt/Uncle",
                "Cousin", "Grand-aunt/uncle", "Other"]
OWNER = ["Client", "Co-client", "Joint", "Trust / entity"]
OWNER_PERSON = ["Client", "Co-client"]
TITLING = ["JTWROS", "Community property"]
CASH_TYPE = ["Checking", "Savings", "CD", "Money market", "Other"]
TAXABLE_TYPE = ["Brokerage", "Trust", "Other"]
RETIRE_TYPE = ["Traditional IRA", "Roth IRA", "401(k)", "403(b)", "401(a)", "SEP IRA",
               "SIMPLE IRA", "HSA", "Other"]
ANNUITY_TAX = ["Non-qualified", "Qualified", "Tax-free"]
ANNUITY_PRODUCT = ["SPIA", "DIA", "MYGA", "Fixed", "Fixed indexed", "Variable", "QLAC"]
ANNUITY_INCOME = ["None", "Income rider (GLWB)", "Annuitized"]
ANNUITY_PAYOUT = ["Single life", "Joint & survivor", "Life w/ period certain",
                  "Period certain", "Cash refund"]
GRANT_TYPE = ["RSU", "NQSO", "ISO"]
NOTE_PAY = ["Amortizing", "Interest-only, balloon"]
PROPERTY_TYPE = ["Primary residence", "Rental property", "Commercial property"]
BUSINESS_TYPE = ["Sole proprietorship", "Partnership", "S-Corp", "C-Corp", "LLC", "Other"]
BUSINESS_TAX = ["QBI (pass-through)", "Ordinary income", "Non-taxable"]
LIABILITY_TYPE = ["Mortgage", "HELOC", "Auto loan", "Student loan", "Personal loan",
                  "Credit card", "Other"]
SS_SOURCE = ["Estimate from salary", "Benefit at full retirement age", "Stated benefit at age",
             "No benefit"]
SS_CLAIM = ["At full retirement age", "At retirement", "At a specific age"]
SS_AGES = [str(a) for a in range(62, 71)]
INCOME_TYPE = ["Business", "Deferred comp", "Capital gains", "Trust", "Other"]
TAX_TYPE = ["Earned income", "Ordinary income", "Qualified dividends", "Capital gains", "QBI",
            "Tax-exempt", "Short-term gains", "Municipal bond interest"]
EXPENSE_TYPE = ["Living", "Insurance", "Education", "Other"]
FREQ = ["Monthly", "Annually"]
CONTRIB = ["Fixed $ amount", "% of salary", "IRS maximum"]
POLICY_TYPE = ["Term", "Whole life", "Universal life", "Variable life"]
INSURED = ["Client", "Co-client", "Joint (survivorship)"]
POLICY_OWNER = ["Client", "Co-client", "Joint", "Trust / entity", "Other"]
PAID_BY = ["Owner", "Client", "Co-client", "Both"]
DI_EARNINGS = ["Salary", "Stated amount"]
DI_RUNS = ["To age", "To SS normal retirement age", "For a number of years", "Lifetime"]
DI_PAYER = ["Employer", "Insured"]
LTC_KIND = ["Traditional standalone", "Rider on a life policy"]
LTC_PER = ["Day", "Month"]
LTC_LAST = ["For a number of years", "Lifetime"]
LTC_PAYS = ["Actual costs (reimbursement)", "Full limit (indemnity)"]
LTC_INFL = ["None", "Simple", "Compound"]
LTC_PREM = ["Lifetime", "To age", "For a number of years", "Paid up"]
TRUST_TYPE = ["Revocable living trust", "Irrevocable", "ILIT", "IDGT", "CLT", "CRT"]
# The app stores a trust's grantor as client, co-client or someone else — there is
# no joint grantor (spec § 8). Will provisions keep their own two-person list.
TRUST_GRANTOR = ["Client", "Co-client", "Someone else"]
WILL_OF = ["Client", "Co-client"]
TRUST_ENDS = ["At client's death", "At co-client's death", "At second death"]
BEQUEST_KIND = ["Specific asset", "Remaining estate", "Debt (who pays)"]
BEQUEST_COND = ["Always", "If co-client survives", "If co-client predeceases"]
BENE_KIND = ["Charity", "Individual"]
CHARITY_TYPE = ["Public charity", "Private foundation"]
DEPENDENT = ["Auto", "Yes", "No"]


class Col:
    """A column (normal table) or a row (transposed table)."""

    def __init__(self, label, weight=1.0, kind="text", options=None):
        self.label, self.weight, self.kind, self.options = label, weight, kind, options or []


def C(label, weight=1.0, options=None, kind=None):
    if kind is None:
        kind = "choice" if options else "text"
    return Col(label, weight, kind, options)


def CHK(label, weight=0.6):
    return Col(label, weight, "check")


def wrap(text, font, size, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if stringWidth(t, font, size) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


class Doc:
    def __init__(self, path, total="?", fill=None):
        self.total = total
        self.fill = fill or {}
        self.c = canvas.Canvas(path, pagesize=(PAGE_W, PAGE_H))
        self.c.setTitle("Client Fact Finder")
        self.c.setAuthor("Foundry Planning")
        self.c.setSubject("Fillable client fact finder")
        self.form = self.c.acroForm
        self.page = 0
        self.y = 0
        self.pages_total = 0

    # ---- page chrome -------------------------------------------------------
    def new_page(self, section):
        if self.page:
            self.c.showPage()
        self.page += 1
        c = self.c
        c.setFillColor(NAVY)
        c.setFont(FONT, 20)
        c.drawString(M, PAGE_H - M - 16, "Client Fact Finder")
        c.setFont(BOLD, 9)
        c.setFillColor(MUTED)
        c.drawRightString(PAGE_W - M, PAGE_H - M - 14, section.upper())
        c.setStrokeColor(NAVY)
        c.setLineWidth(1.2)
        c.line(M, PAGE_H - M - 24, PAGE_W - M, PAGE_H - M - 24)
        c.setFont(FONT, 7)
        c.setFillColor(MUTED)
        c.drawString(M, M - 14, "Confidential — client financial information")
        c.drawRightString(PAGE_W - M, M - 14, f"Page {self.page} of {self.total}")
        self.y = PAGE_H - M - 34

    # ---- fields -----------------------------------------------------------
    def field(self, kind, name, tip, x, y, w, h, options=None, value=""):
        f = self.form
        filled = self.fill.get(name)
        if kind == "check":
            s = min(10, h - 4)
            f.checkbox(name=name, tooltip=tip, x=x + (w - s) / 2, y=y + (h - s) / 2, size=s,
                       buttonStyle="check", borderColor=GRID, fillColor=white,
                       textColor=INK, borderWidth=0.6, fieldFlags="", forceBorder=True,
                       checked=bool(filled))
        elif kind == "choice":
            choice_value = str(filled) if filled else " "
            opts = [" "] + list(options)
            if choice_value not in opts:
                opts.append(choice_value)  # an older copy's list still carried it
            f.choice(name=name, tooltip=tip, value=choice_value, options=opts,
                     x=x + 1, y=y + 1, width=w - 2, height=h - 2, fontName=FONT,
                     fontSize=7.5, borderWidth=0, fillColor=FIELD_BG, textColor=INK,
                     fieldFlags="combo")
        elif kind == "notes":
            f.textfield(name=name, tooltip=tip, value=str(filled) if filled else value,
                        x=x + 1, y=y + 1, width=w - 2, height=h - 2, fontName=FONT,
                        fontSize=8, borderWidth=0, fillColor=FIELD_BG, textColor=INK,
                        fieldFlags="multiline", maxlen=4000)
        else:
            f.textfield(name=name, tooltip=tip, value=str(filled) if filled else value,
                        x=x + 1, y=y + 1, width=w - 2, height=h - 2, fontName=FONT,
                        fontSize=8, borderWidth=0, fillColor=FIELD_BG, textColor=INK,
                        maxlen=200)

    # ---- section heading --------------------------------------------------
    def heading(self, title, hint=None):
        c = self.c
        self.y -= 8
        c.setFont(BOLD, 10.5)
        c.setFillColor(NAVY)
        c.drawString(M, self.y - 10, title)
        if hint:
            c.setFont("Helvetica-Oblique", 7.5)
            c.setFillColor(MUTED)
            c.drawString(M + stringWidth(title, BOLD, 10.5) + 10, self.y - 10, hint)
        self.y -= 15

    # ---- grid helpers -----------------------------------------------------
    def _header_row(self, xs, widths, labels, y_top):
        c = self.c
        size, lead = 7, 8
        wrapped = [wrap(l, BOLD, size, w - 6) for l, w in zip(labels, widths)]
        h = max(len(l) for l in wrapped) * lead + 7
        c.setFillColor(HEAD_BG)
        c.rect(xs[0], y_top - h, sum(widths), h, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont(BOLD, size)
        for x, w, lines in zip(xs, widths, wrapped):
            ty = y_top - 9
            for ln in lines:
                c.drawString(x + 3, ty, ln)
                ty -= lead
        return h

    def _grid(self, xs, widths, y_top, y_bot, row_ys):
        c = self.c
        c.setStrokeColor(GRID)
        c.setLineWidth(0.5)
        x_end = xs[0] + sum(widths)
        c.rect(xs[0], y_bot, x_end - xs[0], y_top - y_bot, stroke=1, fill=0)
        for x in xs[1:]:
            c.line(x, y_top, x, y_bot)
        for ry in row_ys:
            c.line(xs[0], ry, x_end, ry)

    @staticmethod
    def _layout(weights, width, x0=M):
        tot = sum(weights)
        widths = [width * w / tot for w in weights]
        xs, x = [], x0
        for w in widths:
            xs.append(x)
            x += w
        return xs, widths

    # ---- normal table: columns are fields, rows are entries -----------------
    def table(self, key, cols, rows=5, row_labels=None, width=W, x0=M, row_h=ROW_H,
              prefill=None):
        label_w = [0.9] if row_labels else []
        weights = label_w + [col.weight for col in cols]
        xs, widths = self._layout(weights, width, x0)
        labels = ([""] if row_labels else []) + [col.label for col in cols]
        y_top = self.y
        hh = self._header_row(xs, widths, labels, y_top)
        n = len(row_labels) if row_labels else rows
        y = y_top - hh
        row_ys = [y]
        c = self.c
        for r in range(n):
            y -= row_h
            row_ys.append(y)
            ci = 0
            if row_labels:
                c.setFillColor(LABEL_BG)
                c.rect(xs[0], y, widths[0], row_h, stroke=0, fill=1)
                c.setFillColor(INK)
                c.setFont(BOLD, 7.5)
                c.drawString(xs[0] + 3, y + 5.5, row_labels[r])
                ci = 1
            for j, col in enumerate(cols):
                x, w = xs[ci + j], widths[ci + j]
                who = row_labels[r] if row_labels else f"row {r + 1}"
                value = ""
                if prefill and j == 0 and r < len(prefill):
                    value = prefill[r]
                self.field(col.kind, f"{key}_r{r + 1}_c{j + 1}", f"{col.label} — {who}",
                           x, y, w, row_h, col.options, value)
        self._grid(xs, widths, y_top, y, row_ys[:-1])
        self.y = y - 6
        return y_top - y

    # ---- transposed table: rows are fields, columns are entries ------------
    def ttable(self, key, fields, entries, width=W, x0=M, label_weight=1.6, row_h=ROW_H,
               y_top=None):
        weights = [label_weight] + [1.0] * len(entries)
        xs, widths = self._layout(weights, width, x0)
        y_top = self.y if y_top is None else y_top
        hh = self._header_row(xs, widths, [""] + entries, y_top)
        y = y_top - hh
        row_ys = [y]
        c = self.c
        for r, fd in enumerate(fields):
            y -= row_h
            row_ys.append(y)
            c.setFillColor(LABEL_BG)
            c.rect(xs[0], y, widths[0], row_h, stroke=0, fill=1)
            c.setFillColor(INK)
            c.setFont(FONT, 7.5)
            c.drawString(xs[0] + 3, y + 5.5, fd.label)
            for j, ent in enumerate(entries):
                self.field(fd.kind, f"{key}_r{r + 1}_c{j + 1}", f"{fd.label} — {ent}",
                           xs[j + 1], y, widths[j + 1], row_h, fd.options)
        self._grid(xs, widths, y_top, y, row_ys[:-1])
        return y

    def note(self, text):
        self.c.setFont("Helvetica-Oblique", 7.5)
        self.c.setFillColor(MUTED)
        self.c.drawString(M, self.y - 8, text)
        self.y -= 12

    def notes_box(self, key, title, height):
        self.heading(title)
        c = self.c
        c.setStrokeColor(GRID)
        c.setLineWidth(0.5)
        c.rect(M, self.y - height, W, height, stroke=1, fill=0)
        self.field("notes", key, title, M, self.y - height, W, height)
        self.y -= height + 6


def build(path=OUT, total="?", fill=None):
    d = Doc(path, total, fill)

    # ======================= 1. HOUSEHOLD ===================================
    d.new_page("Household")
    c = d.c
    c.setFont(FONT, 8)
    c.setFillColor(MUTED)
    c.drawString(M, d.y - 8, "Fill in what you know and leave the rest blank. Attach your most "
                 "recent statement for every account — we can import them directly.")
    d.y -= 14
    # Prepared-for / date strip
    d.table("meta", [C("Prepared for (household name)", 3), C("Advisor", 2),
                     C("Date completed", 1.2)], rows=1)

    d.heading("Client & Co-client")
    d.table("people", [
        C("First name", 1.2), C("Last name", 1.2), C("Date of birth", 1.0),
        C("Retirement age", 0.75), C("Retirement month", 1.0, MONTHS),
        C("Plan to age (life expectancy)", 0.85), C("Email", 1.7), C("Phone", 1.05),
        C("Mobile", 1.05), C("Covered by workplace retirement plan?", 0.9, YES_NO),
    ], row_labels=["Client", "Co-client"])

    d.heading("Household")
    d.table("household", [
        C("Tax filing status", 1.5, FILING), C("State of residence", 0.8, STATES),
        C("Street address", 2.4), C("Address line 2", 1.2), C("City", 1.3),
        C("State", 0.6, STATES), C("ZIP", 0.7),
    ], rows=1)

    d.heading("Children, Grandchildren & Other Heirs")
    d.table("family", [
        C("First name", 1.3), C("Last name", 1.3), C("Relationship", 1.4, RELATIONSHIP),
        C("Date of birth", 1.0), C("Claimed as dependent?", 0.9, DEPENDENT),
        CHK("Domestic partner", 0.7), C("Notes", 3.0),
    ], rows=8)

    d.heading("Charities & Other Beneficiaries", "People or organizations outside the family "
              "who may receive assets")
    d.table("external", [
        C("Name", 2.5), C("Kind", 1.0, BENE_KIND), C("Charity type", 1.2, CHARITY_TYPE),
        C("Notes", 4.0),
    ], rows=3)

    # ======================= 2. ACCOUNTS ====================================
    d.new_page("Accounts")
    d.note("Columns match our statement import: Name · Value · Basis · Last 4 · Owner · "
           "Custodian · Account type. Owner \"Trust / entity\": write the trust's name "
           "after the account name.")

    d.heading("Cash Accounts")
    d.table("cash", [
        C("Account name", 2.2), C("Current value", 1.1), C("Last 4", 0.6),
        C("Owner", 1.0, OWNER), C("Joint titling", 1.0, TITLING), C("Custodian", 1.6),
        C("Account type", 1.0, CASH_TYPE), C("Interest rate %", 0.8),
    ], rows=5)

    d.heading("Taxable Investment Accounts")
    d.table("taxable", [
        C("Account name", 2.2), C("Current value", 1.1), C("Cost basis", 1.1),
        C("Last 4", 0.6), C("Owner", 1.0, OWNER), C("Joint titling", 1.0, TITLING),
        C("Custodian", 1.6), C("Account type", 1.0, TAXABLE_TYPE),
    ], rows=6)

    d.heading("Retirement Accounts", "Owner is one person — retirement accounts can't be "
              "joint. Inherited? Add the original owner's birth and death years.")
    d.table("retirement", [
        C("Account name", 1.8), C("Current value", 1.0), C("Roth portion (401k/403b)", 0.95),
        C("After-tax basis (IRA)", 0.95), C("Last 4", 0.55), C("Owner", 0.75, OWNER_PERSON),
        C("Custodian", 1.3), C("Account type", 1.05, RETIRE_TYPE),
        C("Inherited?", 0.65, YES_NO), C("Prior year-end value", 0.95),
        C("Primary beneficiary", 1.3), C("Contingent beneficiary", 1.3),
        C("Original owner's birth year", 0.75), C("Original owner's year of death", 0.75),
    ], rows=7)

    # ======================= 3. MORE ACCOUNTS ===============================
    d.new_page("Accounts (continued)")

    d.heading("Annuities")
    d.table("annuity", [
        C("Contract name", 1.7), C("Cash value", 1.0), C("Cost basis", 1.0), C("Last 4", 0.55),
        C("Owner", 0.85, OWNER), C("Carrier / custodian", 1.3),
        C("Tax treatment", 1.0, ANNUITY_TAX), C("Product type", 1.0, ANNUITY_PRODUCT),
        C("Income", 1.2, ANNUITY_INCOME), C("Payout structure", 1.3, ANNUITY_PAYOUT),
    ], rows=4)

    d.heading("529 / Education Savings")
    d.table("edu", [
        C("Account name", 2.0), C("Current value", 1.1), C("Basis (contributions)", 1.1),
        C("Last 4", 0.6), C("Owner", 1.0, OWNER), C("Custodian", 1.5),
        C("Beneficiary (student)", 1.6), C("Grantor (who funded it)", 1.6),
    ], rows=4)

    d.heading("Stock Options & Equity Awards")
    d.table("equity", [
        C("Company / plan", 1.6), C("Ticker", 0.6), C("Grant type", 0.75, GRANT_TYPE),
        C("Grant #", 0.8), C("Grant date", 0.9), C("Shares granted", 0.9),
        C("Strike price", 0.8), C("Expiration date", 0.9), C("Vesting schedule", 2.2),
        C("Owner", 0.8, OWNER_PERSON),
    ], rows=4)

    d.heading("Notes Receivable", "Money owed to you, e.g. a loan to family or from a "
              "business sale")
    d.table("notes_rec", [
        C("Name / borrower", 1.8), C("Original amount", 1.0), C("Current balance", 1.0),
        C("Balance as of (mo/yr)", 0.9), C("Interest rate %", 0.75),
        C("Payment type", 1.2, NOTE_PAY), C("Monthly payment", 0.95),
        C("Start (mo/yr)", 0.8), C("Term (months)", 0.75), C("Owner", 0.9, OWNER),
    ], rows=3)

    # ======================= 4. PROPERTY, BUSINESS, DEBTS ===================
    d.new_page("Real Estate, Business & Debts")

    d.heading("Real Estate")
    d.table("realestate", [
        C("Property name", 1.6), C("Property type", 1.2, PROPERTY_TYPE),
        C("Current value", 1.0), C("Cost basis", 1.0), C("Owner", 0.9, OWNER),
        C("Joint titling", 1.0, TITLING), C("Address", 2.2), C("Annual property tax", 0.95),
        C("Mortgage on it (name)", 1.3),
    ], rows=5)

    d.heading("Business Interests")
    d.table("business", [
        C("Business name", 1.7), C("Business type", 1.1, BUSINESS_TYPE),
        C("Current value", 1.0), C("Cost basis", 1.0), C("Owner(s) & %", 1.6),
        C("Tax treatment", 1.2, BUSINESS_TAX), C("Share of earnings distributed %", 0.95),
        C("Annual income", 1.0), C("Annual expense", 1.0),
    ], rows=4)

    d.heading("Liabilities", "Mortgages, HELOCs, auto, student, personal loans, credit cards")
    d.table("liab", [
        C("Loan name", 1.5), C("Type", 0.95, LIABILITY_TYPE), C("Owner", 0.85, OWNER),
        C("Balance", 0.95), C("Balance as of", 0.8), C("Interest rate %", 0.7),
        C("Monthly P&I", 0.85), C("Monthly escrow (tax/ins.)", 0.85),
        C("Loan start (mo/yr)", 0.8), C("Term (years)", 0.6), C("Matures", 0.75),
        C("Interest deductible?", 0.75, YES_NO), C("Property it's on", 1.2),
    ], rows=7)

    # ======================= 5. INCOME ======================================
    d.new_page("Income")

    d.heading("Salary & Wages", "End year blank = stops at retirement")
    d.table("salary", [
        C("Employer", 2.4), C("Annual salary", 1.2),
        C("Annual raise %", 0.9), C("Start year", 0.9), C("End year", 0.9),
    ], row_labels=["Client", "Co-client"])

    d.heading("Social Security", "A copy of each ssa.gov statement is the best source")
    d.table("ss", [
        C("How should we set the benefit?", 1.7, SS_SOURCE),
        C("Monthly benefit $", 1.0), C("Benefit stated at age", 0.9),
        C("When to claim", 1.5, SS_CLAIM), C("Claim age (years)", 0.8, SS_AGES),
        C("Claim age (+ months)", 0.8), C("Annual COLA %", 0.8),
    ], row_labels=["Client", "Co-client"])

    d.heading("Other Income", "Pensions (type: Other), deferred comp, business, trust "
              "distributions, rental income, etc.")
    d.table("income", [
        C("Income name", 1.8), C("Type", 1.1, INCOME_TYPE), C("Owner", 0.8,
                                                                   ["Client", "Co-client", "Joint"]),
        C("Annual amount", 1.0), C("Annual increase %", 0.8), C("Start year", 0.75),
        C("End year", 0.75), C("Tax type", 1.3, TAX_TYPE), C("Paid in month (if once a year)",
                                                               0.95, MONTHS),
        C("Survivor continues %", 0.85),
    ], rows=7)

    # ======================= 6. EXPENSES & SAVINGS ==========================
    d.new_page("Expenses & Savings")

    d.heading("Living Expenses", "Growth blank = general inflation")
    d.table("living", [
        C("Annual amount", 1.2), C("Annual increase %", 1.0), C("Start year", 0.9),
        C("End year", 0.9), C("Notes", 3.5),
    ], row_labels=["Current", "In retirement"])

    d.heading("Itemized Current Living Expenses (optional)",
              "Don't include loan payments or insurance premiums listed elsewhere")
    gap = 10
    third = (W - 2 * gap) / 3
    items = [
        ["Groceries", "Utilities", "Transportation", "Healthcare", "Dining out"],
        ["Travel", "Entertainment", "Clothing", "Home maintenance", "Personal care"],
        ["Gifts & giving", "Subscriptions", "", "", ""],
    ]
    y0 = d.y
    low = y0
    for i in range(3):
        d.y = y0
        d.table(f"living_items{i + 1}", [C("Item", 2.0), C("Amount", 1.1),
                                         C("Frequency", 1.1, FREQ)],
                rows=5, width=third, x0=M + i * (third + gap), prefill=items[i])
        low = min(low, d.y)
    d.y = low

    d.heading("Other Expenses", "Education, travel goals, care for a parent, large "
              "purchases, etc.")
    d.table("expenses", [
        C("Expense name", 2.0), C("Type", 0.9, EXPENSE_TYPE), C("Annual amount", 1.0),
        C("Annual increase %", 0.8), C("Start year", 0.8), C("End year", 0.8),
        CHK("A goal?", 0.55), C("Notes", 2.6),
    ], rows=5)

    d.heading("Planned Savings", "Ongoing contributions to any account above")
    d.table("savings", [
        C("Account", 1.7), C("Contribution", 1.05, CONTRIB), C("Annual $", 0.85),
        C("% of salary", 0.7), C("Roth % (401k/403b)", 0.75), C("Employer match %", 0.75),
        C("Match up to (% of salary)", 0.8), C("Employer flat $", 0.8),
        C("Start year", 0.7), C("End year", 0.7), C("Annual increase %", 0.75),
    ], rows=5)

    # ======================= 7. LIFE INSURANCE ==============================
    d.new_page("Insurance")
    d.heading("Life Insurance", "Attach the latest annual statement or in-force illustration")
    life_fields = [
        C("Policy name"), C("Carrier"), C("Policy type", options=POLICY_TYPE),
        C("Insured", options=INSURED), C("Owner", options=POLICY_OWNER), C("Death benefit"),
        C("Current cash value"), C("Cost basis (premiums paid)"), C("Annual premium"),
        C("Premium paid by", options=PAID_BY), C("Premium payment years"),
        C("Term: issue year"), C("Term: length (years)"),
        C("Term ends at insured's retirement?", options=YES_NO), C("Policy #"),
        C("Primary beneficiary"), C("Contingent beneficiary"),
    ]
    d.y = d.ttable("life", life_fields, [f"Policy {i}" for i in range(1, 6)],
                   label_weight=1.5) - 6
    d.notes_box("insurance_notes", "Group / employer coverage & notes", 70)

    # ======================= 8. DISABILITY & LTC ============================
    d.new_page("Insurance (continued)")
    half = (W - 16) / 2
    d.heading("Disability Insurance")
    di_fields = [
        C("Policy name"), C("Carrier"), C("Who is covered", options=OWNER_PERSON),
        C("Covered earnings", options=DI_EARNINGS), C("Covered earnings amount"),
        C("Short-term coverage?", options=YES_NO), C("STD waiting period (days)"),
        C("STD benefit (% of earnings)"), C("STD duration (weeks)"), C("STD monthly cap"),
        C("Long-term coverage?", options=YES_NO), C("LTD waiting period (days)"),
        C("LTD benefit (% of earnings)"), C("LTD monthly cap"),
        C("Benefits run", options=DI_RUNS), C("…to age / for years"),
        C("Benefits taxable?", options=YES_NO), C("Annual increase %"), C("Annual premium"),
        C("Who pays the premium", options=DI_PAYER),
    ]
    ltc_fields = [
        C("Policy name"), C("Carrier"), C("Who is covered", options=OWNER_PERSON),
        C("Policy type", options=LTC_KIND), C("Life policy (if rider)"), C("Issue year"),
        C("Benefit amount"), C("Benefit per", options=LTC_PER),
        C("Benefits last", options=LTC_LAST), C("Benefit years"),
        C("Waiting period (days)"), C("Home care pays (% of limit)"),
        C("Policy pays", options=LTC_PAYS), C("Shared care?", options=YES_NO),
        C("State partnership policy?", options=YES_NO),
        C("Inflation protection", options=LTC_INFL), C("Inflation rate %"),
        C("Annual premium"), C("Premiums paid", options=LTC_PREM),
        C("…to age / for years"),
    ]
    top = d.y
    d.ttable("disability", di_fields, ["Policy 1", "Policy 2"], width=half,
             label_weight=1.45)
    c = d.c
    c.setFont(BOLD, 10.5)
    c.setFillColor(NAVY)
    c.drawString(M + half + 16, top + 5, "Long-Term Care Insurance")
    d.ttable("ltc", ltc_fields, ["Policy 1", "Policy 2"], width=half, x0=M + half + 16,
             label_weight=1.45, y_top=top)

    # ======================= 9. ESTATE ======================================
    d.new_page("Estate Plan")
    d.heading("Documents in Place", "Check each one that exists today")
    d.table("estate_docs", [
        CHK("Will"), CHK("Revocable living trust", 0.8), CHK("ILIT"), CHK("IDGT"), CHK("CLT"),
        CHK("CRT"), CHK("Other irrevocable trust", 0.8), C("Last updated (year)", 0.9),
        C("Estate attorney", 2.6),
    ], row_labels=["Client", "Co-client"])

    d.heading("Trusts")
    d.table("trusts", [
        C("Trust name", 1.8), C("Trust type", 1.25, TRUST_TYPE), C("Grantor", 0.7, TRUST_GRANTOR),
        C("Trustee", 1.3), C("Grantor trust (you pay its tax)?", 0.85, YES_NO),
        C("Crummey powers?", 0.7, YES_NO), C("Trust ends", 1.05, TRUST_ENDS),
        C("Income beneficiaries", 1.4), C("Remainder beneficiaries", 1.4),
    ], rows=5)

    d.heading("Will Provisions", "Specific gifts first, then who receives the rest")
    d.table("bequests", [
        C("Will of", 0.7, WILL_OF), C("Gift", 1.1, BEQUEST_KIND),
        C("Asset / account / debt", 2.0), C("% of it", 0.6), C("Recipient(s) & shares", 2.6),
        C("Condition", 1.3, BEQUEST_COND),
    ], rows=6)

    d.heading("Prior Lifetime Gifts", "Gifts above the annual exclusion, or any gift to a "
              "trust")
    d.table("gifts", [
        C("Year", 0.6), C("From", 0.8, ["Client", "Co-client", "Joint (split gift)"]),
        C("Recipient (person or trust)", 2.0), C("Cash or asset given", 2.0),
        C("Amount / value", 1.0), C("Gift tax return (709) filed?", 0.95, YES_NO),
    ], rows=4)

    # ======================= 10. HOLDINGS ===================================
    d.new_page("Investment Holdings")
    d.heading("Investment Holdings (optional)", "Skip this page if you're attaching "
              "statements — we import holdings from them")
    d.table("holdings", [
        C("Account (name or last 4)", 1.8), C("Ticker", 0.7), C("Security name", 2.6),
        C("Shares", 0.9), C("Price", 0.9), C("Market value", 1.1), C("Cost basis", 1.1),
    ], rows=19)
    d.notes_box("final_notes", "Anything else we should know?", 64)

    d.c.showPage()
    d.c.save()
    return d.page


def main():
    parser = argparse.ArgumentParser(description="Build the Client Fact Finder PDF.")
    parser.add_argument("--out", default=OUT, help="output PDF path")
    parser.add_argument("--fill", help="JSON file of field name -> value")
    args = parser.parse_args()
    fill = None
    if args.fill:
        with open(args.fill) as fh:
            fill = json.load(fh)
    n = build(args.out, fill=fill)           # first pass counts pages
    build(args.out, total=n, fill=fill)      # second pass prints "Page x of n"
    print(f"wrote {args.out} ({n} pages)")


if __name__ == "__main__":
    main()
