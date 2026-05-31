import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { config } from '../../config'
import latticePolicyLogo from '../../assets/lattice-policy-logo.svg'
import { getDefaultPermissionsForRoles } from '../../auth/permissions'

export function LoginPage() {
  const [username, setUsername] = useState('agent1')
  const [password, setPassword] = useState('password')
  const [tenantId, setTenantId] = useState(() => localStorage.getItem('tenantId') || 'sample-carrier')
  const [mfaStep, setMfaStep] = useState<'credentials' | 'verify' | 'setup'>('credentials')
  const [mfaToken, setMfaToken] = useState('')
  const [otp, setOtp] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [otpAuthUri, setOtpAuthUri] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const { login } = useAuth()

  const resetMfaFlow = () => {
    setMfaStep('credentials')
    setMfaToken('')
    setOtp('')
    setManualKey('')
    setOtpAuthUri('')
  }

  const finishLogin = (token: string, user: any, fallbackTenant: string) => {
    login(token, user as any)
    localStorage.setItem('tenantId', user?.tenantId || fallbackTenant)
    nav('/')
  }

  const postAuth = async (path: string, hdrTenant: string, payload: any) => {
    const res = await fetch(`${config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': hdrTenant },
      body: JSON.stringify(payload)
    })
    const text = await res.text()
    const data = text ? (() => { try { return JSON.parse(text) } catch { return text } })() : {}
    if (!res.ok) {
      if (typeof data === 'object' && data) {
        throw new Error((data as any).message || (data as any).code || `Request failed (${res.status})`)
      }
      throw new Error(String(data || `Request failed (${res.status})`))
    }
    return data
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const hdrTenant = tenantId || 'sample-carrier'
      if (!config.apiBaseUrl || config.useMock) {
        // Mock login for local preview without API
        const demoUsers: Record<string, string[]> = { admin: ['admin'], actuary1: ['actuary'], uw1: ['underwriter'], agent1: ['agent'], customer1: ['customer'] }
        const roles = demoUsers[username]
        if (!roles || password !== 'password') throw new Error('INVALID_CREDENTIALS')
        const user = {
          id: `demo-${username}`,
          username,
          tenantId: hdrTenant,
          roles,
          permissions: getDefaultPermissionsForRoles(roles)
        }
        finishLogin('mock-token', user, hdrTenant)
        return
      }
      if (mfaStep === 'verify') {
        const data: any = await postAuth('/auth/mfa/verify', hdrTenant, { challengeToken: mfaToken, otp })
        if (!data?.token || !data?.user) throw new Error('MFA verification failed')
        finishLogin(data.token, data.user, hdrTenant)
        return
      }
      if (mfaStep === 'setup') {
        const data: any = await postAuth('/auth/mfa/setup/confirm', hdrTenant, { setupToken: mfaToken, otp })
        if (!data?.token || !data?.user) throw new Error('MFA setup failed')
        finishLogin(data.token, data.user, hdrTenant)
        return
      }

      const data: any = await postAuth('/auth/login', hdrTenant, { username, password, tenantId: hdrTenant })
      if (data?.token && data?.user) {
        finishLogin(data.token, data.user, hdrTenant)
        return
      }
      if (data?.mfaRequired && data?.setupRequired && data?.setupToken) {
        setMfaStep('setup')
        setMfaToken(String(data.setupToken))
        setOtp('')
        setManualKey(String(data.manualKey || ''))
        setOtpAuthUri(String(data.otpAuthUri || ''))
        return
      }
      if (data?.mfaRequired && data?.challengeToken) {
        setMfaStep('verify')
        setMfaToken(String(data.challengeToken))
        setOtp('')
        return
      }
      throw new Error('Unexpected login response')
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setLoading(false) }
  }

  return (
    <section className="login-shell">
      <div className="login-stage">
        <div className="login-brand login-brand--center">
          <img src={latticePolicyLogo} alt="LatticePolicy" className="login-brand-logo" />
        </div>
        <div className="card login-card">
        <h2 className="login-title">Sign in to your account</h2>
        <p className="login-subtitle">Enter your credentials and organization to continue</p>
        <form onSubmit={onSubmit}>
          {mfaStep === 'credentials' && (
            <>
              <label>Organization Slug</label>
              <input
                value={tenantId}
                onChange={e => {
                  setTenantId(e.target.value)
                  resetMfaFlow()
                }}
                placeholder="e.g. sample-carrier"
              />
              <label>Email / Username</label>
              <input
                value={username}
                onChange={e => {
                  setUsername(e.target.value)
                  resetMfaFlow()
                }}
              />
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => {
                  setPassword(e.target.value)
                  resetMfaFlow()
                }}
              />
            </>
          )}
          {mfaStep !== 'credentials' && (
            <>
              <p className="muted">
                {mfaStep === 'setup'
                  ? 'MFA is required. Add this account in your authenticator app, then enter the 6-digit code.'
                  : 'MFA is required. Enter your 6-digit authenticator code to continue.'}
              </p>
              {mfaStep === 'setup' && (
                <>
                  {manualKey && (
                    <>
                      <label>Manual Setup Key</label>
                      <input value={manualKey} readOnly />
                    </>
                  )}
                  {otpAuthUri && <p className="muted">Authenticator URI: {otpAuthUri}</p>}
                </>
              )}
              <label>Verification Code</label>
              <input
                value={otp}
                onChange={e => setOtp(String(e.target.value || '').replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
              />
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div className="login-submit-row">
            <button type="submit" disabled={loading}>
              {mfaStep === 'credentials'
                ? 'Login'
                : mfaStep === 'setup'
                  ? 'Enable MFA & Login'
                  : 'Verify & Login'}
            </button>
            {mfaStep !== 'credentials' && (
              <button type="button" className="btn-secondary" onClick={resetMfaFlow} disabled={loading}>
                Back
              </button>
            )}
          </div>
        </form>
        {mfaStep === 'credentials' && (
          <div className="login-demo-box">
            <strong>Demo Credentials</strong>
            <div>Org slug: <span className="muted">{tenantId || 'sample-carrier'}</span></div>
            <div>Agent: <span className="muted">agent1 / password</span></div>
            <div>Underwriter: <span className="muted">uw1 / password</span></div>
            <div>Actuary: <span className="muted">actuary1 / password</span></div>
            <div>Admin: <span className="muted">admin / password</span></div>
          </div>
        )}
        <div className="login-footer-link">
          <a href="/login">Admin Login →</a>
        </div>
        <div className="muted login-help">
          MFA-enabled tenants will prompt for a verification code after credential sign-in.
        </div>
        </div>
      </div>
    </section>
  )
}
