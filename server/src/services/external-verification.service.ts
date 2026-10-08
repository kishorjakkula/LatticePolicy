/**
 * External-verification extension point (PURE PLUMBING — NOT A REAL INTEGRATION).
 *
 * This repository has no integration with any third-party data vendor
 * (no CLUE loss-history report, no MVR driving-record pull, no identity or
 * fraud-data bureau — nothing). `quote-bind.service.ts` calls into this
 * module at bind time as a well-defined extension point so that, in the
 * future, a real vendor integration can be wired in by writing a second
 * implementation of `ExternalVerificationProvider` and configuring it —
 * without touching the bind flow again.
 *
 * `NoopExternalVerificationProvider` is the ONLY implementation shipped in
 * this codebase. It always returns a clean "no findings" result. As long as
 * no real provider is configured (today, nothing configures one anywhere in
 * this codebase), `runExternalVerification` is a complete no-op and can
 * never affect a bind.
 *
 * Do NOT use this module to fabricate, simulate, or stub an actual vendor
 * response. If/when a real integration is built, it belongs in its own
 * dedicated service that implements this interface honestly (real HTTP
 * calls, real credentials, real error handling) — not inside this file.
 */

/** One concrete, named finding an external verification provider reports. */
export interface ExternalVerificationFinding {
  /** Short, stable machine-readable code, e.g. 'MVR_VIOLATION_MISMATCH'. */
  code: string
  /** Human-readable description an underwriter can read on the referral. */
  description: string
}

/** The narrow slice of submission data an external provider may need. */
export interface ExternalVerificationRequest {
  tenantId: string
  productCode: string
  stateCode: string | null
  effectiveDate: string
  insuredDisplayName: string | null
  /** The matched internal customer id, when this submission matched one. */
  customerId: string | null
  /** Self-reported qualification answers from the current submission. */
  qualificationAnswers: Record<string, unknown> | null
}

export interface ExternalVerificationResult {
  /** Name of the provider that produced this result (for audit/logging). */
  provider: string
  findings: ExternalVerificationFinding[]
}

/**
 * Implement this interface to wire in a real external data vendor. The
 * method receives only the narrow submission data above — no interest in,
 * or access to, anything beyond what bind-time underwriting needs.
 */
export interface ExternalVerificationProvider {
  readonly name: string
  verify(request: ExternalVerificationRequest): Promise<ExternalVerificationResult>
}

/**
 * The default, always-inert provider. Returns "no external findings" for
 * every request, unconditionally. This is intentional: this codebase does
 * not have a real vendor relationship to call, and pretending otherwise
 * would be misleading in an insurance product.
 */
export class NoopExternalVerificationProvider implements ExternalVerificationProvider {
  readonly name = 'noop'

  async verify(_request: ExternalVerificationRequest): Promise<ExternalVerificationResult> {
    return { provider: this.name, findings: [] }
  }
}

const defaultProvider = new NoopExternalVerificationProvider()

/**
 * Entry point `quote-bind.service.ts` calls at bind time. Defaults to the
 * inert no-op provider when no `provider` is passed — which is always, for
 * every caller in this codebase today. Passing a different provider (e.g.
 * in a test, or a future real integration) is the only way findings can
 * ever be non-empty.
 */
export async function runExternalVerification(
  request: ExternalVerificationRequest,
  provider: ExternalVerificationProvider = defaultProvider
): Promise<ExternalVerificationResult> {
  return provider.verify(request)
}
