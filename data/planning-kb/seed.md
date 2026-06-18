# Planning Knowledge Base — Curated Seed

This file is the tiny curated global seed for the forge planning knowledge base.
Each section below is one document: an HTML comment declares its `source` (one of
`planning_playbook | tax_reference | client_document | firm_note | other`) and a
human-readable `ref` (the citable `sourceRef`). The prose after the heading, up to
the next comment, is the document body. All seed rows are global (`firm_id = null`,
`client_id = null`). Ingest with `tsx scripts/ingest-planning-kb.ts`.

<!-- source: planning_playbook | ref: Planning Playbook §IRMAA -->
## IRMAA surcharge planning framework

IRMAA (the income-related monthly adjustment amount) raises a retiree's Medicare
Part B and Part D premiums once modified adjusted gross income crosses fixed
thresholds. The surcharge is a cliff, not a phase-in: one dollar of MAGI over a
bracket boundary moves the household to the next tier for the whole year, and the
look-back uses the tax return from two years prior. When deciding how much income
to recognize in a given year — a Roth conversion, a capital gain, an extra IRA
withdrawal — check the distance to the next IRMAA boundary before filling a tax
bracket. It is often worth stopping a conversion a few thousand dollars short of a
boundary to avoid two years of surcharges across both spouses. Because IRMAA is
assessed per person, a surviving spouse who files single can be pushed into a high
tier on the same income that was comfortable while filing jointly.

<!-- source: planning_playbook | ref: Planning Playbook §RMD-sequencing -->
## RMD and withdrawal sequencing framework

Required minimum distributions begin at the SECURE 2.0 age and force taxable
income out of pre-tax accounts whether or not the household needs the cash. Plan
for them years in advance: the window between retirement and the first RMD is the
cheapest time to convert pre-tax dollars to Roth, because the household often sits
in a temporarily low bracket before Social Security and RMDs stack on top. A
common sequencing rule is to spend taxable (brokerage) assets first to let
tax-deferred accounts keep compounding, but that rule reverses when large future
RMDs would spike the bracket — then partial Roth conversions or earlier IRA
withdrawals in the low-bracket window reduce the lifetime tax bill. Always weigh
the bracket today against the projected bracket once RMDs and survivor-filing
status are in force.

<!-- source: planning_playbook | ref: Planning Playbook §estate-exemption -->
## Estate exemption and portability framework

The federal estate-and-gift exemption is unified and portable between spouses: a
deceased spouse's unused exemption (DSUE) can be elected onto the survivor's
exemption by filing a timely estate-tax return, even when no tax is due. Because
the exemption is scheduled to change, plans should model both the current and the
post-sunset exemption and show the household the difference in projected estate
tax. Lifetime gifting uses the same unified exemption, so large gifts made now
reduce the exemption available at death but also move future appreciation out of
the estate. State estate taxes often have far lower exemptions than the federal
one and rarely offer portability, so a couple in a decoupled state may need
credit-shelter (bypass) trust planning that the federal rules alone would not
require.

<!-- source: tax_reference | ref: Tax Reference §LTCG-0-bracket -->
## Long-term capital gains 0% bracket

Long-term capital gains and qualified dividends are taxed at 0%, 15%, or 20%
depending on taxable income, stacked ON TOP of ordinary income. The 0% rate
applies to gains that fall below the top of the 0% threshold after ordinary income
is counted first. In a low-income year — early retirement before Social Security,
or a year with large deductions — a household can realize long-term gains up to
that threshold at a 0% federal rate, resetting cost basis for free. This
"gain harvesting" is the mirror image of loss harvesting and is most valuable in
the same low-bracket window used for Roth conversions; the two strategies compete
for the same bracket space, so they must be coordinated.

<!-- source: tax_reference | ref: Tax Reference §QCD -->
## Qualified charitable distributions

A qualified charitable distribution lets a taxpayer at or above the QCD-eligible
age send up to an annual limit directly from an IRA to a qualified charity. The
distribution counts toward the year's required minimum distribution but is
excluded from adjusted gross income entirely — a stronger benefit than an itemized
charitable deduction because lowering AGI also helps with IRMAA, the taxation of
Social Security benefits, and any AGI-based phaseouts. QCDs are especially useful
for charitably inclined retirees who take the standard deduction, since they would
otherwise get no tax benefit from their giving. The funds must go directly from
the IRA custodian to the charity to qualify.
