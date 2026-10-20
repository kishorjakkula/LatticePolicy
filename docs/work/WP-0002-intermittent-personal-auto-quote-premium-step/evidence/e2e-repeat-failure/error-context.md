# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quote-wizard.spec.ts >> new business quote wizard >> quotes, rates, binds, and issues a personal auto policy entirely in the browser
- Location: e2e/quote-wizard.spec.ts:20:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first() with timeout 10000ms
  - waiting for getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()

```

```yaml
- banner:
  - strong: Sample Carrier
  - navigation:
    - link "Dashboard":
      - /url: /dashboard
    - link "Search":
      - /url: /search
    - link "Submissions":
      - /url: /submissions
    - link "Rating":
      - /url: /rating
    - link "Administration":
      - /url: /admin
  - search "Quick lookup":
    - 'searchbox "Quick lookup: policy, quote, or customer"'
  - text: admin admin
  - button "Open API Docs"
  - button "Sign out"
- main:
  - navigation "Breadcrumb":
    - link "Home":
      - /url: /dashboard
    - link "Policies":
      - /url: /search
    - text: PC-7998479C
  - text: Policy workflow
  - heading "Policy PC-7998479C" [level=1]
  - text: In Force Customer
  - link "CUST-2026-000105 - Wizmveidvf819291c20 Tester":
    - /url: /customers/c7f79d60-1afc-4b5b-b4c9-2d03bc21f458
  - text: Policy Premium -
  - button "Collapse section" [expanded]: −
  - heading "Policy Actions" [level=3]
  - button "Endorse" [disabled]
  - button "Cancel" [disabled]
  - button "Reinstate" [disabled]
  - button "Rewrite" [disabled]
  - button "Renew" [disabled]
  - button "Non-Renew"
  - button "Collapse section" [expanded]: −
  - heading "Policy Summary" [level=3]
  - text: Product personal-auto Term 1 Policy Effective Date 10-19-2026 Policy Expiration Date 10-19-2027
  - group: + View policy as of a date
  - button "Collapse section" [expanded]: −
  - heading "Transactions" [level=3]
  - table:
    - rowgroup:
      - 'row "Transaction # Effective Date Transaction Effective Date Expiration Created Date Updated Date v Updated User Type Amount Audit"':
        - 'columnheader "Transaction #"':
          - 'button "Transaction #"'
        - columnheader "Effective Date":
          - button "Effective Date"
        - columnheader "Transaction Effective Date":
          - button "Transaction Effective Date"
        - columnheader "Expiration":
          - button "Expiration"
        - columnheader "Created Date":
          - button "Created Date"
        - columnheader "Updated Date v":
          - button "Updated Date v"
        - columnheader "Updated User":
          - button "Updated User"
        - columnheader "Type":
          - button "Type"
        - columnheader "Amount":
          - button "Amount"
        - columnheader "Audit"
    - rowgroup:
      - row "No versions":
        - cell "No versions"
  - button "Collapse section" [expanded]: −
  - heading "Documents" [level=3]
  - paragraph: "API GET /v1/policies/7998479c-8b6e-433e-9a81-9ac142cb64c6/documents failed 429: Too many requests, please try again later."
  - group: "- AI / ML Insights API GET /v1/ai/policies/7998479c-8b6e-433e-9a81-9ac142cb64c6/insights failed 429: Too many requests, please try again later."
  - paragraph: "API GET /v1/policies/7998479c-8b6e-433e-9a81-9ac142cb64c6/timeline failed 429: Too many requests, please try again later."
- region "Notifications"
```

# Test source

```ts
  1   | import { expect, test } from './support/fixtures'
  2   | import { uniqueName } from './support/api'
  3   | import {
  4   |   answerAllQualificationQuestions,
  5   |   continueToStep,
  6   |   createPrimaryInsured,
  7   |   expectWizardStep,
  8   |   fieldByLabel,
  9   |   fillVehicle,
  10  |   ratePremium,
  11  |   selectProduct,
  12  | } from './support/wizard'
  13  | 
  14  | function insuredName() {
  15  |   const first = uniqueName('Wiz').replace(/[^a-zA-Z0-9]/g, '')
  16  |   return { first, last: 'Tester', full: `${first} Tester` }
  17  | }
  18  | 
  19  | test.describe('new business quote wizard', () => {
  20  |   test('quotes, rates, binds, and issues a personal auto policy entirely in the browser', { tag: '@smoke' }, async ({ page, signInAs }) => {
  21  |     await signInAs(page, 'admin')
  22  |     const insured = insuredName()
  23  | 
  24  |     await page.goto('/wizard')
  25  |     await expect(page.getByRole('heading', { name: 'New Quote Wizard' })).toBeVisible()
  26  |     await expectWizardStep(page, 1)
  27  | 
  28  |     await selectProduct(page)
  29  |     await continueToStep(page, 2)
  30  |     await expect(page.getByRole('main')).toContainText(/Quote #\s*Q\d{8}-/)
  31  | 
  32  |     await answerAllQualificationQuestions(page)
  33  |     await continueToStep(page, 3)
  34  | 
  35  |     await createPrimaryInsured(page, insured.first, insured.last)
  36  |     await continueToStep(page, 4)
  37  | 
  38  |     await fillVehicle(page, insured.full)
  39  |     await continueToStep(page, 5)
  40  | 
  41  |     await page.getByRole('button', { name: 'Apply Default Coverages' }).click()
  42  |     await expect(page.getByRole('checkbox').first()).toBeChecked()
  43  |     await continueToStep(page, 6)
  44  | 
  45  |     await expect(page.getByRole('heading', { name: 'Vehicles' })).toBeVisible()
  46  |     // VIN decode can refine the model year and trim, so match make and model only.
  47  |     await expect(page.getByRole('main')).toContainText(/Vehicle 1\s*\d{4} Toyota Camry/)
  48  |     await ratePremium(page)
  49  |     await expect(page.getByRole('row').filter({ hasText: 'BI - Bodily Injury Liability' })).toBeVisible()
  50  |     // WP-0002: never another product's coverages (the homeowners set seen in the defect).
  51  |     await expect(page.getByRole('row').filter({ hasText: /\bEND_(WB|PPRC|ORD|ERC)\b|Dwelling/ })).toHaveCount(0)
  52  |     await expect(page.getByRole('status').filter({ hasText: 'Pending' })).toBeVisible()
  53  | 
  54  |     await continueToStep(page, 8)
  55  |     await expect(page.getByRole('row').filter({ hasText: 'PA-DEC' }).first()).toBeVisible()
  56  | 
  57  |     await page.getByRole('button', { name: 'Bind', exact: true }).click()
  58  |     await expect(page.getByRole('status').filter({ hasText: 'Bound' })).toBeVisible()
  59  |     await expect(page.getByText('Policy is bound. Issue to lock it.')).toBeVisible()
  60  |     const policyLink = page.getByRole('link', { name: /Policy #PC-/ })
  61  |     await expect(policyLink).toBeVisible()
  62  |     const policyNumber = ((await policyLink.textContent()) || '').replace('Policy #', '').trim()
  63  | 
  64  |     await page.getByRole('button', { name: 'Issue', exact: true }).click()
  65  |     await expect(page.getByRole('status').filter({ hasText: 'Issued' })).toBeVisible()
  66  |     await expect(page.getByText('Policy is issued and locked.')).toBeVisible()
  67  |     await expect(page.getByRole('row').filter({ hasText: 'Issue' }).filter({ hasText: 'PA-DEC' })).toBeVisible()
  68  | 
  69  |     await page.getByRole('button', { name: 'View Policy' }).click()
  70  |     await expect(page).toHaveURL(/\/policies\//)
  71  |     await expect(page.getByRole('heading', { name: `Policy ${policyNumber}` })).toBeVisible()
> 72  |     await expect(page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()).toBeVisible()
      |                                                                                  ^ Error: expect(locator).toBeVisible() failed
  73  |   })
  74  | 
  75  |   test('blocks each step until its required data is supplied', async ({ page, signInAs }) => {
  76  |     await signInAs(page, 'admin')
  77  |     const insured = insuredName()
  78  | 
  79  |     await page.goto('/wizard')
  80  |     await selectProduct(page)
  81  |     await continueToStep(page, 2)
  82  | 
  83  |     // Qualification answers are mandatory.
  84  |     await page.getByRole('button', { name: /^Continue to/ }).click()
  85  |     await expect(page.getByText('Required').first()).toBeVisible()
  86  |     await expectWizardStep(page, 2)
  87  |     await answerAllQualificationQuestions(page)
  88  |     await continueToStep(page, 3)
  89  | 
  90  |     // A primary named insured is mandatory.
  91  |     await page.getByRole('button', { name: /^Continue to/ }).click()
  92  |     await expect(page.getByText('Primary insured first name is required')).toBeVisible()
  93  |     await expectWizardStep(page, 3)
  94  |     await createPrimaryInsured(page, insured.first, insured.last)
  95  |     await continueToStep(page, 4)
  96  | 
  97  |     // Vehicle details are mandatory.
  98  |     await page.getByRole('button', { name: /^Continue to/ }).click()
  99  |     await expect(page.getByText('Make is required')).toBeVisible()
  100 |     await expect(page.getByText('VIN is required')).toBeVisible()
  101 |     await expect(page.getByText('Garaging ZIP is required')).toBeVisible()
  102 |     await expectWizardStep(page, 4)
  103 |     await fillVehicle(page, insured.full)
  104 |     await continueToStep(page, 5)
  105 |     await continueToStep(page, 6)
  106 | 
  107 |     // Premium must be rated before moving on.
  108 |     await page.getByRole('button', { name: /^Continue to/ }).click()
  109 |     await expect(page.getByText('Rate premium before continuing to Premium.')).toBeVisible()
  110 |     await expectWizardStep(page, 6)
  111 |   })
  112 | 
  113 |   test('saves a draft that can be found again from the Quotes search tab', async ({ page, signInAs }) => {
  114 |     await signInAs(page, 'admin')
  115 | 
  116 |     await page.goto('/wizard')
  117 |     await selectProduct(page)
  118 |     await continueToStep(page, 2)
  119 |     await expect(page.getByRole('main')).toContainText(/Q\d{8}-\w+/)
  120 |     const quoteNumber = (await page.getByRole('main').innerText()).match(/Q\d{8}-\w+/)![0]
  121 | 
  122 |     await page.getByRole('button', { name: 'Save Draft' }).click()
  123 |     await expect(page).toHaveURL(/quoteId=/)
  124 | 
  125 |     await page.goto('/search?mode=quotes')
  126 |     await expect(page.getByRole('tab', { name: /Quotes/ })).toHaveAttribute('aria-selected', 'true')
  127 |     await page.getByRole('textbox', { name: 'Search' }).fill(quoteNumber)
  128 |     await page.getByRole('button', { name: 'Search', exact: true }).click()
  129 |     const draftRow = page.getByRole('row').filter({ hasText: quoteNumber })
  130 |     await expect(draftRow).toContainText('Draft')
  131 |     await expect(draftRow).toContainText('personal-auto')
  132 | 
  133 |     // Re-opening the draft resumes on the step where it was saved.
  134 |     await draftRow.getByRole('link', { name: quoteNumber }).click()
  135 |     await expect(page).toHaveURL(/\/wizard\?quoteId=/)
  136 |     await expect(page.getByRole('main')).toContainText(quoteNumber)
  137 |     await expectWizardStep(page, 2)
  138 |   })
  139 | 
  140 |   test('limits the product list to the selected underwriting company', async ({ page, signInAs }) => {
  141 |     await signInAs(page, 'admin')
  142 | 
  143 |     await page.goto('/wizard')
  144 |     await fieldByLabel(page, 'Underwriting Company').selectOption({ label: 'Sample Carrier Property' })
  145 |     await fieldByLabel(page, 'Country').selectOption('US')
  146 |     await fieldByLabel(page, 'State').selectOption('TX')
  147 |     const product = fieldByLabel(page, 'Product')
  148 |     await expect(product.locator('option')).toHaveText(['Select product', 'Homeowners'])
  149 |   })
  150 | 
  151 |   // Regression: the Insureds step used the admin customer API, which the agent
  152 |   // role cannot call, so producers were stuck on step 3.
  153 |   test('agent creates a new insured, finds an existing one, and binds the quote', async ({ page, signInAs }) => {
  154 |     await signInAs(page, 'agent1')
  155 |     const insured = insuredName()
  156 | 
  157 |     await page.goto('/wizard')
  158 |     await selectProduct(page)
  159 |     await continueToStep(page, 2)
  160 |     await answerAllQualificationQuestions(page)
  161 |     await continueToStep(page, 3)
  162 |     await createPrimaryInsured(page, insured.first, insured.last)
  163 |     await continueToStep(page, 4)
  164 |     await fillVehicle(page, insured.full)
  165 |     await continueToStep(page, 5)
  166 |     await page.getByRole('button', { name: 'Apply Default Coverages' }).click()
  167 |     await continueToStep(page, 6)
  168 |     await ratePremium(page)
  169 |     await continueToStep(page, 8)
  170 |     await page.getByRole('button', { name: 'Bind', exact: true }).click()
  171 |     await expect(page.getByRole('status').filter({ hasText: 'Bound' })).toBeVisible()
  172 | 
```