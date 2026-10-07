import { useEffect, useState } from 'react'
import { authHeaders, tenantId } from '../../api/request'
import { config } from '../../config'

export function ApiDocsRedirectPage() {
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const openDocs = async () => {
      try {
        if (!config.apiBaseUrl) throw new Error('API URL is not configured')
        const response = await fetch(`${config.apiBaseUrl}/api-docs/session`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant': tenantId(),
            ...authHeaders(),
          },
        })
        if (!response.ok) throw new Error(`API Docs session failed (${response.status})`)
        const payload = await response.json()
        window.location.replace(String(payload.url || `${config.apiBaseUrl}/api-docs`))
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to open API Docs')
      }
    }
    void openDocs()
    return () => { active = false }
  }, [])

  return (
    <section className="policy-section-card" aria-live="polite">
      <h1>API Docs</h1>
      {error ? <p className="error">{error}</p> : <p className="muted">Opening authenticated API documentation...</p>}
    </section>
  )
}
