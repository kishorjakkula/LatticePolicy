# Sample submissions for intake

Fictional broker submissions for trying submission intake (`/submissions`).
Upload all files in one folder as one submission. Names, numbers, and
addresses are made up; the "ACORD" files are plain-text samples laid out
like the forms, not ACORD forms.

| Folder | Product | What it shows |
| --- | --- | --- |
| `commercial-auto/` | Commercial Auto | Four documents (email, application, vehicle schedule, loss runs). The application and the vehicle schedule give different garaging ZIPs (43215 and 43219), so that value arrives as **documents disagree** and you pick one. The broker's email describes the business in sentences, which the built-in reader does not use. The loss run shows an open claim. |
| `cyber/` | Cyber | Email plus application. Yes/No answers map to the product's true/false fields. The email mentions a contained ransomware attempt that matches "Prior Cyber Incidents: 1". |
| `homeowners/` | Homeowners | One application for a person, not a company: insured type is drafted with low confidence, so you confirm it. |

Each upload drafts most values with high confidence and leaves a few for you
to fill in, such as the address state or the broker name. Approval then
checks your carrier's rules. For example, the cyber and commercial auto
samples include a FEIN and contact details, so a new customer can be created.

With `INTAKE_AI_PROVIDER=anthropic`, Claude also reads the sentences in the
emails (business description, the ransomware note) and PDFs or scans you add.
