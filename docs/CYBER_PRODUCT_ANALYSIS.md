# Cyber Product Analysis (Specialty Insurance)

## Scope
- Product code: `cyber`
- Target: SME/commercial cyber package for quote/bind/issue flow.

## Risk/Insured Data to Capture
- Industry segment (`technology`, `healthcare`, `finance`, `retail`, `manufacturing`, `education`, `professional-services`, `other`)
- Annual revenue (USD)
- Employee count
- Sensitive records count
- Security controls:
  - MFA enabled
  - Endpoint protection enabled
  - Backup cadence (`daily`, `weekly`, `monthly`, `none`)
- Prior cyber incidents (count over last 3 years)
- Public-facing application count
- Primary domain

## Coverage Model
- `CYB_LIAB` Cyber Liability / Privacy
- `BIZ_INT` Business Interruption
- `CYB_EXT` Cyber Extortion
- `IR_EXP` Incident Response Expenses
- `DATA_REC` Data Recovery
- `MEDIA` Media Liability

Each coverage has selectable limits + deductibles in product config.

## Baseline Rating Design
1. Start with base rate by term.
2. Apply multiplicative factors:
   - industry
   - revenue band
   - employee band
   - records band
   - security control factors (MFA, endpoint protection, backups)
3. Apply load for prior incidents and public-facing apps (capped).
4. Allocate premium by selected coverages.
5. Apply policy fee + tax.

## Underwriting Guardrails
- Refer/decline behavior based on:
  - prior incident count
  - weak controls (e.g., no MFA)
  - large exposure profile (revenue/workforce/records)

## Notes
- This implementation is a configurable baseline model and should be calibrated using carrier loss experience and filing requirements before production use.
