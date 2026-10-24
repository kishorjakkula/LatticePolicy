# Product intake demo files

Synthetic labeled-text applications. No real customer data. Names, FEINs,
contact details and addresses are test-only; addresses are not intended to pass
a real address-validation service.

## Upload

1. Open Submissions and create a new submission.
2. Choose the matching product and upload **one** `*-application.txt` file.
3. Compare the extracted fields with that product in `expected-results.json`.
4. Review all values, complete carrier-specific requirements, and approve only
   as an authorized human. The upload itself must not create a customer/quote.

Do not upload the README, fixtures JSON or expected-results JSON.

| File | Product |
| --- | --- |
| `businessowners-application.txt` | Businessowners Policy (BOP), Ohio single-premises tenant office; demo setup required before rating |

`fixtures.json` is the independent source of sample values;
`server/src/services/__tests__/businessowners-intake.test.ts` checks the mapped
draft against it. Dates are fixed at December 1, 2026; update them for later
demonstrations. The built-in reader supports these TXT files without
internet/model access. This verifies labeled-field ingestion, **not** real LLM
inference, PDF/image OCR or end-to-end approval.
