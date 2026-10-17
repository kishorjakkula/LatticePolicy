# Sample submissions for intake

Fictional broker submissions for trying submission intake (`/submissions`).
Upload all files in one folder as one submission. Names, numbers, and
addresses are made up; the "ACORD" files are plain-text samples laid out
like the forms, not ACORD forms.

| Folder | Product | What it shows |
| --- | --- | --- |
| `commercial-auto/` | Commercial Auto | Four documents (email, application, vehicle schedule, loss runs). The application and the vehicle schedule give different garaging ZIPs (43215 and 43219), so that value arrives as **documents disagree** and you pick one. The broker's email describes the business in sentences, which the built-in reader does not use. The loss run shows an open claim. |
| `cyber/` | Cyber | Email plus application. Yes/No answers map to the product's true/false fields. The email mentions a contained ransomware attempt that matches "Prior Cyber Incidents: 1". |
| `cyber-complete/` | Cyber | Every field labelled exactly in two documents that agree, so every value scores the built-in reader's maximum, **95%**. Choose **Cyber** as the product when uploading and the product scores **100%**. |
| `homeowners/` | Homeowners (HO-3) | Renewal shopping: broker email, homeowner application, prior declarations, and the lender's requirements letter. Drafts the dwelling, Coverages A, E, F, deductibles, prior insurance, monthly direct billing, the mortgagee (agreeing across three documents), and the eligibility answers, with no conflicts. |
| `homeowners-new-purchase/` | Homeowners (HO-3) | First home, no prior policy. The application is a **Word (.docx)** file; a CSV inspection report confirms the dwelling. Requests endorsements (water back-up $10,000, personal property replacement cost, extended replacement cost 25%), a $2,500 deductible, $500,000 liability, quarterly agency billing, and the lender as mortgagee. |
| `homeowners-conflicts/` | Homeowners (HO-3) | A seasonal coastal home. The inspection disagrees with the application on **year built** (1985 or 1979) and **roof type** (metal or wood shake), so both arrive as conflicts to resolve. 5% wind/hail deductible, 12 miles to the fire station, and two eligibility answers of "No" (prior claims, vacancy), so expect an underwriting referral. Three eligibility questions are missing; answer them in review. |
| `commercial-auto-lienholder/` | Commercial Auto | Common fields on another product: an equipment lender as **lienholder** (loss payee), monthly direct billing, and prior policy number and expiration. Requests a $1,000,000 liability limit and collision/comprehensive deductibles. |

Each upload drafts most values with high confidence and leaves a few for you
to fill in, such as the address state or the broker name. Approval then
checks your carrier's rules. For example, the cyber and commercial auto
samples include a FEIN and contact details, so a new customer can be created.

With `INTAKE_AI_PROVIDER=anthropic`, Claude also reads the sentences in the
emails (business description, the ransomware note) and PDFs or scans you add.

## Why not 100% everywhere?

The built-in reader matches labels; it cannot know a value is right, so its
maximum is 95% (exact label, and two documents agree). 100% is kept for a
value a person set, such as the product chosen at upload. Claude reports its
own score and may give 100% to a value a document states plainly.
